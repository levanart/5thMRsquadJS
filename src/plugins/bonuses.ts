import { TPlayerDisconnected } from 'squad-logs';
import { z } from 'zod';
import { EVENTS } from '../constants';
import { definePlugin } from '../core/plugin';
import {
  awardUserBonusesForMinute,
  createUserIfNullableOrUpdateName,
} from '../rnsdb';
import { TPlayer } from '../types';

const BONUS_MINUTE_MS = 60_000;
const SCHEDULER_INTERVAL_MS = 5_000;
const DATABASE_RETRY_COOLDOWN_MS = 10_000;
const MAX_BONUS_PER_MINUTE = 1_000;
const MAX_SERVER_PLAYERS = 200;

const bonusSchema = z.coerce.number().int().min(0).max(MAX_BONUS_PER_MINUTE);
const layerNameSchema = z.string().trim().min(1).max(128);

const optionsSchema = z
  .object({
    classicBonus: bonusSchema.default(0),
    seedBonus: bonusSchema.default(0),
    minPlayers: z.coerce
      .number()
      .int()
      .min(0)
      .max(MAX_SERVER_PLAYERS)
      .default(0),
    maxPlayersOnSeed: z.coerce
      .number()
      .int()
      .min(0)
      .max(MAX_SERVER_PLAYERS)
      .default(0),
    seedKeyword: z.string().trim().max(64).default('Seed'),
    seedLayers: z
      .union([layerNameSchema, z.array(layerNameSchema).max(100)])
      .default([]),
  })
  .superRefine((options, context) => {
    const layers = Array.isArray(options.seedLayers)
      ? options.seedLayers
      : [options.seedLayers];
    if (!options.seedKeyword && layers.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'seedKeyword или seedLayers должен быть указан',
        path: ['seedKeyword'],
      });
    }
    if (
      options.maxPlayersOnSeed > 0 &&
      options.maxPlayersOnSeed <= options.minPlayers
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'maxPlayersOnSeed должен быть больше minPlayers или равен 0',
        path: ['maxPlayersOnSeed'],
      });
    }
  });

interface TrackedPlayer {
  steamID: string;
  eosID: string;
  playerController?: string;
  name: string;
  nextAwardAt: number;
  userReady: boolean;
  ensurePromise?: Promise<boolean>;
}

const canonicalText = (value: string): string =>
  value.trim().toLocaleLowerCase('ru-RU');

const toLayerList = (value: string | string[]): string[] =>
  [...new Set(Array.isArray(value) ? value : [value])]
    .map((item) => canonicalText(item))
    .filter(Boolean);

export const isSeedBonusLayer = (
  layer: string | null | undefined,
  seedKeyword: string,
  seedLayers: string[],
): boolean => {
  if (!layer) return false;
  const normalizedLayer = canonicalText(layer);
  if (seedLayers.includes(normalizedLayer)) return true;

  const keyword = canonicalText(seedKeyword);
  return Boolean(
    keyword && normalizedLayer.split(/[_\-\s.]+/u).includes(keyword),
  );
};

export default definePlugin({
  name: 'bonuses',
  description: 'Начисление бонусов за время на сервере.',
  optionsSchema,
  setup({ state, options, logger, registerDisposable }) {
    const { listener } = state;
    const explicitSeedLayers = toLayerList(options.seedLayers);
    const trackedPlayers = new Map<string, TrackedPlayer>();
    let schedulerRunning = false;
    let databaseBlockedUntil = 0;
    let disposed = false;

    const blockDatabase = (error: unknown) => {
      const now = Date.now();
      if (now >= databaseBlockedUntil) {
        logger.error(`[bonuses] ошибка MongoDB: ${String(error)}`);
      }
      databaseBlockedUntil = Math.max(
        databaseBlockedUntil,
        now + DATABASE_RETRY_COOLDOWN_MS,
      );
    };

    const ensurePlayer = (player: TrackedPlayer): Promise<boolean> => {
      if (player.userReady) return Promise.resolve(true);
      if (player.ensurePromise) return player.ensurePromise;

      const promise = (async () => {
        try {
          const ready = await createUserIfNullableOrUpdateName(
            state.id,
            player.steamID,
            player.name,
            player.eosID,
          );
          if (!ready) {
            blockDatabase('соединение ещё не установлено');
            return false;
          }
          if (!disposed && trackedPlayers.get(player.steamID) === player) {
            player.userReady = true;
          }
          return true;
        } catch (error) {
          blockDatabase(error);
          return false;
        } finally {
          player.ensurePromise = undefined;
        }
      })();

      player.ensurePromise = promise;
      return promise;
    };

    const trackPlayer = (
      player: TPlayer,
      now: number,
    ): TrackedPlayer | null => {
      if (!player.steamID) return null;

      const existing = trackedPlayers.get(player.steamID);
      if (existing) {
        existing.name = player.name;
        existing.eosID = player.eosID;
        existing.playerController = player.playerController;
        return existing;
      }

      const tracked: TrackedPlayer = {
        steamID: player.steamID,
        eosID: player.eosID,
        playerController: player.playerController,
        name: player.name,
        nextAwardAt: now + BONUS_MINUTE_MS,
        userReady: false,
      };
      trackedPlayers.set(player.steamID, tracked);
      return tracked;
    };

    const primePlayers = (players: TrackedPlayer[]) => {
      void (async () => {
        for (const player of players) {
          if (disposed || Date.now() < databaseBlockedUntil) return;
          if (!(await ensurePlayer(player))) return;
        }
      })();
    };

    const syncPlayers = (now = Date.now(), ensureAdded = true) => {
      const present = new Set<string>();
      const added: TrackedPlayer[] = [];

      for (const player of state.players ?? []) {
        if (!player.steamID) continue;
        present.add(player.steamID);
        const wasTracked = trackedPlayers.has(player.steamID);
        const tracked = trackPlayer(player, now);
        if (tracked && !wasTracked) added.push(tracked);
      }

      for (const steamID of trackedPlayers.keys()) {
        if (!present.has(steamID)) trackedPlayers.delete(steamID);
      }

      if (ensureAdded) primePlayers(added);
    };

    const pauseAccrual = (now: number) => {
      for (const player of trackedPlayers.values()) {
        player.nextAwardAt = now + BONUS_MINUTE_MS;
      }
    };

    const awardPlayer = async (
      player: TrackedPlayer,
      isSeed: boolean,
      minuteSlot: number,
    ): Promise<boolean> => {
      if (!(await ensurePlayer(player))) return false;

      const award = {
        steamID: player.steamID,
        name: player.name,
        baseBonus: isSeed ? options.seedBonus : options.classicBonus,
        isSeed,
        minuteSlot,
      };

      try {
        let status = await awardUserBonusesForMinute(state.id, award);

        if (status === 'missing-user') {
          player.userReady = false;
          if (!(await ensurePlayer(player))) return false;
          status = await awardUserBonusesForMinute(state.id, award);
        }

        if (status === 'unavailable' || status === 'missing-user') {
          blockDatabase(status);
          return false;
        }
        return true;
      } catch (error) {
        blockDatabase(error);
        return false;
      }
    };

    const runScheduler = async () => {
      if (schedulerRunning || disposed) return;
      schedulerRunning = true;

      try {
        const now = Date.now();
        if (now < databaseBlockedUntil) return;

        const layer = state.currentMap?.layer;
        if (!layer || trackedPlayers.size < options.minPlayers) {
          pauseAccrual(now);
          return;
        }

        const isSeed = isSeedBonusLayer(
          layer,
          options.seedKeyword,
          explicitSeedLayers,
        );
        if (
          isSeed &&
          options.maxPlayersOnSeed > 0 &&
          trackedPlayers.size >= options.maxPlayersOnSeed
        ) {
          pauseAccrual(now);
          return;
        }
        const minuteSlot = Math.floor(now / BONUS_MINUTE_MS);
        const duePlayers = [...trackedPlayers.values()].filter(
          (player) => player.nextAwardAt <= now,
        );

        for (const player of duePlayers) {
          if (disposed || Date.now() < databaseBlockedUntil) return;
          if (await awardPlayer(player, isSeed, minuteSlot)) {
            player.nextAwardAt = now + BONUS_MINUTE_MS;
          }
        }
      } finally {
        schedulerRunning = false;
      }
    };

    const onPlayersUpdated = () => syncPlayers();
    const onPlayerConnected = () => syncPlayers();
    const onPlayerDisconnected = (data: TPlayerDisconnected) => {
      for (const [steamID, player] of trackedPlayers) {
        const sameEOSID = Boolean(data.eosID) && data.eosID === player.eosID;
        const sameController =
          Boolean(data.playerController) &&
          data.playerController === player.playerController;
        if (sameEOSID || sameController) trackedPlayers.delete(steamID);
      }
    };
    const onNewGame = () => pauseAccrual(Date.now());
    const runSchedulerSafely = () => {
      void runScheduler().catch((error) =>
        logger.error(`[bonuses] ошибка планировщика: ${String(error)}`),
      );
    };

    // На этом этапе штатное подключение MongoDB ещё может инициализироваться.
    // Первый UPDATED_PLAYERS или само начисление гарантированно создаст записи.
    syncPlayers(Date.now(), false);
    const scheduler = setInterval(runSchedulerSafely, SCHEDULER_INTERVAL_MS);
    listener.on(EVENTS.PLAYER_CONNECTED, onPlayerConnected);
    listener.on(EVENTS.PLAYER_DISCONNECTED, onPlayerDisconnected);
    listener.on(EVENTS.UPDATED_PLAYERS, onPlayersUpdated);
    listener.on(EVENTS.NEW_GAME, onNewGame);

    registerDisposable(() => {
      disposed = true;
      clearInterval(scheduler);
      listener.off(EVENTS.PLAYER_CONNECTED, onPlayerConnected);
      listener.off(EVENTS.PLAYER_DISCONNECTED, onPlayerDisconnected);
      listener.off(EVENTS.UPDATED_PLAYERS, onPlayersUpdated);
      listener.off(EVENTS.NEW_GAME, onNewGame);
      trackedPlayers.clear();
    });
  },
});
