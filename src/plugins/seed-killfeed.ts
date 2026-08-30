import {
  TNewGame,
  TPlayerDamaged,
  TPlayerDied,
  TPlayerRevived,
  TPlayerWounded,
} from 'squad-logs';
import { TMap } from 'squad-rcon';
import { z } from 'zod';
import { EVENTS } from '../constants';
import { adminWarn } from '../core';
import { definePlugin } from '../core/plugin';
import { TPlayer } from '../types';

const CONTROL_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
const STEAM_ID = /^\d{17}$/;
const layerNameSchema = z.string().trim().min(1).max(128);

const optionsSchema = z
  .object({
    seedKeyword: z.string().trim().max(64).default('Seed'),
    seedLayers: z
      .union([layerNameSchema, z.array(layerNameSchema).max(100)])
      .default([]),
    message: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .default('Ты убил противника: {victim}'),
    maxMessageBytes: z.coerce.number().int().min(64).max(2048).default(512),
    dedupeWindowMs: z.coerce.number().int().min(0).max(60000).default(5000),
    contextTtlMs: z.coerce
      .number()
      .int()
      .min(1000)
      .max(1800000)
      .default(300000),
    maxQueueSize: z.coerce.number().int().min(1).max(100).default(25),
    sendTimeoutMs: z.coerce.number().int().min(500).max(60000).default(5000),
    sendRetries: z.coerce.number().int().min(0).max(2).default(1),
    retryDelayMs: z.coerce.number().int().min(0).max(30000).default(1000),
    failureCooldownMs: z.coerce
      .number()
      .int()
      .min(0)
      .max(300000)
      .default(30000),
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
  });

interface CombatContext {
  attackerSteamID?: string;
  attackerEOSID?: string;
  attackerController?: string;
  weapon?: string;
  createdAt: number;
}

interface PendingWarning {
  steamID: string;
  text: string;
  generation: number;
}

class WarningTimeoutError extends Error {}
class WarningCancelledError extends Error {}

const cleanText = (value: string): string =>
  value
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/;/g, ',')
    .replace(/\s+/g, ' ')
    .trim();

const canonicalName = (value: string): string =>
  cleanText(value).toLocaleLowerCase('ru-RU');

const namesMatch = (playerName: string, logName: string): boolean => {
  const full = canonicalName(playerName);
  const observed = canonicalName(logName);
  if (!full || !observed) return false;
  if (full === observed) return true;
  if (!full.endsWith(observed)) return false;

  const prefix = full.slice(0, -observed.length);
  return /[\s\])}>]$/.test(prefix);
};

const truncateUtf8 = (value: string, maxBytes: number): string => {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;

  let result = '';
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result.trimEnd();
};

const toList = (value: string | string[]): string[] =>
  [...new Set(Array.isArray(value) ? value : [value])]
    .map((item) => item.trim())
    .filter(Boolean);

const isSeedLayer = (
  layer: string | null | undefined,
  seedKeyword: string,
  explicitLayers: Set<string>,
): boolean => {
  if (!layer) return false;

  const normalizedLayer = canonicalName(layer);
  if (explicitLayers.has(normalizedLayer)) return true;

  const keyword = canonicalName(seedKeyword);
  if (!keyword) return false;
  return normalizedLayer.split(/[_\-\s.]+/u).includes(keyword);
};

const formatWeapon = (weapon: string | null | undefined): string => {
  const value = cleanText(weapon ?? '');
  const basename = value.split(/[/.]/).pop() ?? value;
  return (
    basename
      .replace(/_C(?:_\d+)?$/, '')
      .replace(/^BP_/, '')
      .trim() || 'неизвестно'
  );
};

const renderMessage = (
  template: string,
  data: Record<'attacker' | 'victim' | 'weapon' | 'layer', string>,
): string =>
  template.replace(
    /\{(attacker|victim|weapon|layer)\}/g,
    (_match, key: keyof typeof data) => data[key],
  );

const playerIdentity = (player: TPlayer): string =>
  player.steamID ||
  player.eosID ||
  player.playerController ||
  `name:${canonicalName(player.name)}`;

export default definePlugin({
  name: 'seedKillfeed',
  description: 'AdminWarn убийце о килле противника только на seed-слоях.',
  optionsSchema,
  setup({ state, options, logger, registerDisposable }) {
    const { listener, execute } = state;
    const explicitLayers = new Set(
      toList(options.seedLayers).map(canonicalName),
    );
    const knownPlayers = new Map<string, TPlayer>();
    const combatContexts = new Map<string, CombatContext>();
    const seenDeaths = new Map<string, number>();
    const ambiguousNames = new Set<string>();
    let pendingWarnings: PendingWarning[] = [];
    let playersSnapshotReady = true;
    let activeLayer = state.currentMap?.layer ?? '';
    let generation = 0;
    let generationController = new AbortController();
    let draining = false;
    let blockedUntil = 0;
    let queueOverflowLogged = false;
    let disposed = false;

    const layerIsSeed = () =>
      isSeedLayer(activeLayer, options.seedKeyword, explicitLayers);

    const rememberPlayer = (player: TPlayer) => {
      const id = playerIdentity(player);
      for (const [knownID, known] of knownPlayers) {
        const sameSteamID =
          Boolean(player.steamID) && player.steamID === known.steamID;
        const sameEOSID = Boolean(player.eosID) && player.eosID === known.eosID;
        const sameController =
          Boolean(player.playerController) &&
          player.playerController === known.playerController;
        if (knownID !== id && (sameSteamID || sameEOSID || sameController)) {
          knownPlayers.delete(knownID);
        }
      }
      knownPlayers.set(id, { ...knownPlayers.get(id), ...player });
    };

    const rememberCurrentPlayers = () => {
      if (!playersSnapshotReady) return;
      for (const player of state.players ?? []) rememberPlayer(player);
    };

    const findPlayerByIDs = (ids: {
      steamID?: string | null;
      eosID?: string | null;
      playerController?: string | null;
    }): TPlayer | null => {
      rememberCurrentPlayers();
      for (const player of knownPlayers.values()) {
        if (ids.steamID && player.steamID === ids.steamID) return player;
        if (ids.eosID && player.eosID === ids.eosID) return player;
        if (
          ids.playerController &&
          player.playerController === ids.playerController
        ) {
          return player;
        }
      }
      return null;
    };

    const findPlayerByName = (
      name: string,
    ): { player: TPlayer | null; ambiguous: boolean } => {
      rememberCurrentPlayers();
      const matches = [...knownPlayers.values()].filter((player) =>
        namesMatch(player.name, name),
      );
      const unique = new Map(
        matches.map((player) => [playerIdentity(player), player]),
      );
      return {
        player: unique.size === 1 ? [...unique.values()][0] : null,
        ambiguous: unique.size > 1,
      };
    };

    const pruneTransientData = (now: number) => {
      for (const [name, context] of combatContexts) {
        if (now - context.createdAt > options.contextTtlMs) {
          combatContexts.delete(name);
        }
      }
      for (const [key, seenAt] of seenDeaths) {
        if (now - seenAt > options.dedupeWindowMs) seenDeaths.delete(key);
      }
    };

    const rememberCombatContext = (
      victimName: string,
      context: Omit<CombatContext, 'createdAt'>,
    ) => {
      const now = Date.now();
      pruneTransientData(now);
      combatContexts.set(canonicalName(victimName), {
        ...context,
        createdAt: now,
      });
    };

    const onPlayerDamaged = (data: TPlayerDamaged) => {
      rememberCombatContext(data.victimName, {
        attackerSteamID: data.attackerSteamID,
        attackerEOSID: data.attackerEOSID,
        attackerController: data.attackerController,
        weapon: data.weapon,
      });
    };

    const onPlayerWounded = (data: TPlayerWounded) => {
      rememberCombatContext(data.victimName, {
        attackerSteamID: data.attackerSteamID,
        attackerEOSID: data.attackerEOSID,
        attackerController: data.attackerPlayerController,
        weapon: data.weapon,
      });
    };

    const onPlayerRevived = (data: TPlayerRevived) => {
      combatContexts.delete(canonicalName(data.victimName));
    };

    const deathKey = (data: TPlayerDied): string =>
      data.raw ||
      [
        data.time,
        data.chainID,
        canonicalName(data.victimName),
        data.attackerSteamID,
        data.attackerEOSID,
        data.weapon,
      ].join('|');

    const isDuplicateDeath = (data: TPlayerDied): boolean => {
      if (options.dedupeWindowMs <= 0) return false;

      const now = Date.now();
      pruneTransientData(now);
      const key = deathKey(data);
      const previous = seenDeaths.get(key);
      seenDeaths.set(key, now);
      return previous !== undefined && now - previous <= options.dedupeWindowMs;
    };

    const wait = (delayMs: number, signal: AbortSignal): Promise<boolean> => {
      if (delayMs <= 0) return Promise.resolve(!signal.aborted && !disposed);

      return new Promise((resolve) => {
        if (signal.aborted || disposed) {
          resolve(false);
          return;
        }
        const onAbort = () => {
          clearTimeout(timer);
          resolve(false);
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve(true);
        }, delayMs);
        signal.addEventListener('abort', onAbort, { once: true });
      });
    };

    const withTimeout = <T>(
      promise: Promise<T>,
      timeoutMs: number,
      signal: AbortSignal,
    ): Promise<T> =>
      new Promise((resolve, reject) => {
        let settled = false;
        const onAbort = () =>
          finish(() => reject(new WarningCancelledError('cancelled')));
        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          callback();
        };
        const timer = setTimeout(
          () =>
            finish(() =>
              reject(
                new WarningTimeoutError(`RCON timeout after ${timeoutMs}ms`),
              ),
            ),
          timeoutMs,
        );
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(
          (value) => finish(() => resolve(value)),
          (error) => finish(() => reject(error)),
        );
      });

    const sendWarning = async (
      warning: PendingWarning,
      signal: AbortSignal,
    ): Promise<boolean> => {
      for (let attempt = 0; attempt <= options.sendRetries; attempt++) {
        if (signal.aborted || disposed) return false;
        try {
          await withTimeout(
            adminWarn(execute, warning.steamID, warning.text),
            options.sendTimeoutMs,
            signal,
          );
          return true;
        } catch (error) {
          if (error instanceof WarningCancelledError) return false;
          logger.error(
            `[seedKillfeed] AdminWarn error (${attempt + 1}/${
              options.sendRetries + 1
            }): ${String(error)}`,
          );
          if (
            error instanceof WarningTimeoutError ||
            attempt >= options.sendRetries
          ) {
            return false;
          }
          if (!(await wait(options.retryDelayMs, signal))) return false;
        }
      }
      return false;
    };

    const drainWarnings = async () => {
      if (draining || disposed) return;
      draining = true;
      try {
        while (pendingWarnings.length > 0 && !disposed) {
          const warning = pendingWarnings.shift();
          if (!warning) break;
          if (warning.generation !== generation) continue;

          const warningGeneration = warning.generation;
          const successful = await sendWarning(
            warning,
            generationController.signal,
          );
          if (warningGeneration !== generation) continue;
          if (!successful) {
            blockedUntil = Date.now() + options.failureCooldownMs;
            pendingWarnings = pendingWarnings.filter(
              (item) => item.generation !== warningGeneration,
            );
            break;
          }
          queueOverflowLogged = false;
        }
      } finally {
        draining = false;
        if (pendingWarnings.length > 0 && !disposed) void drainWarnings();
      }
    };

    const enqueueWarning = (steamID: string, text: string) => {
      if (disposed || Date.now() < blockedUntil) return;
      if (pendingWarnings.length >= options.maxQueueSize) {
        if (!queueOverflowLogged) {
          queueOverflowLogged = true;
          logger.warn('[seedKillfeed] warning queue is full, messages dropped');
        }
        return;
      }
      pendingWarnings.push({ steamID, text, generation });
      void drainWarnings();
    };

    const onPlayerDied = (data: TPlayerDied) => {
      const contextKey = canonicalName(data.victimName);
      const context = combatContexts.get(contextKey);
      combatContexts.delete(contextKey);

      if (!layerIsSeed() || isDuplicateDeath(data)) return;

      const victimResolution = findPlayerByName(data.victimName);
      if (victimResolution.ambiguous) {
        if (!ambiguousNames.has(contextKey)) {
          ambiguousNames.add(contextKey);
          logger.warn(
            `[seedKillfeed] ambiguous victim name, event skipped: ${cleanText(
              data.victimName,
            )}`,
          );
        }
        return;
      }
      const victim = victimResolution.player;
      if (!victim) return;

      const attacker =
        findPlayerByIDs({
          steamID: data.attackerSteamID,
          eosID: data.attackerEOSID,
          playerController: data.attackerPlayerController,
        }) ||
        findPlayerByIDs({
          steamID: context?.attackerSteamID,
          eosID: context?.attackerEOSID,
          playerController: context?.attackerController,
        });
      if (!attacker || !STEAM_ID.test(attacker.steamID)) return;
      if (playerIdentity(attacker) === playerIdentity(victim)) return;
      if (!attacker.teamID || !victim.teamID) return;
      if (attacker.teamID === victim.teamID) return;

      const text = truncateUtf8(
        cleanText(
          renderMessage(options.message, {
            attacker: cleanText(attacker.name),
            victim: cleanText(victim.name),
            weapon: formatWeapon(context?.weapon || data.weapon),
            layer: cleanText(activeLayer),
          }),
        ),
        options.maxMessageBytes,
      );
      if (!text) return;

      enqueueWarning(attacker.steamID, text);
    };

    const onPlayersUpdated = (players: TPlayer[]) => {
      playersSnapshotReady = true;
      for (const player of players ?? []) rememberPlayer(player);
    };

    const onCurrentMap = (map: TMap) => {
      activeLayer = map?.layer ?? '';
    };

    const resetRound = (data?: TNewGame) => {
      generation++;
      generationController.abort();
      generationController = new AbortController();
      pendingWarnings = [];
      combatContexts.clear();
      seenDeaths.clear();
      ambiguousNames.clear();
      knownPlayers.clear();
      playersSnapshotReady = false;
      blockedUntil = 0;
      queueOverflowLogged = false;
      activeLayer = data?.layerClassname ?? '';
    };

    rememberCurrentPlayers();
    listener.on(EVENTS.UPDATED_PLAYERS, onPlayersUpdated);
    listener.on(EVENTS.SHOW_CURRENT_MAP, onCurrentMap);
    listener.on(EVENTS.PLAYER_DAMAGED, onPlayerDamaged);
    listener.on(EVENTS.PLAYER_WOUNDED, onPlayerWounded);
    listener.on(EVENTS.PLAYER_REVIVED, onPlayerRevived);
    listener.on(EVENTS.PLAYER_DIED, onPlayerDied);
    listener.prependListener(EVENTS.NEW_GAME, resetRound);

    registerDisposable(() => {
      disposed = true;
      generationController.abort();
      pendingWarnings = [];
      listener.off(EVENTS.UPDATED_PLAYERS, onPlayersUpdated);
      listener.off(EVENTS.SHOW_CURRENT_MAP, onCurrentMap);
      listener.off(EVENTS.PLAYER_DAMAGED, onPlayerDamaged);
      listener.off(EVENTS.PLAYER_WOUNDED, onPlayerWounded);
      listener.off(EVENTS.PLAYER_REVIVED, onPlayerRevived);
      listener.off(EVENTS.PLAYER_DIED, onPlayerDied);
      listener.off(EVENTS.NEW_GAME, resetRound);
      combatContexts.clear();
      seenDeaths.clear();
      ambiguousNames.clear();
      knownPlayers.clear();
    });
  },
});
