import {
  TPlayerDamaged,
  TPlayerDied,
  TPlayerRevived,
  TPlayerWounded,
} from 'squad-logs';
import { z } from 'zod';
import { EVENTS } from '../constants';
import { adminBroadcast } from '../core';
import { definePlugin } from '../core/plugin';
import { TPlayer } from '../types';

const MAX_PLAYER_NAME_LENGTH = 64;
const COMBAT_CONTEXT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_KNIFE_WEAPONS = [
  'Knife',
  'Bayonet',
  'Bayo',
  'SOCP',
  'QNL-95',
  'OKC-3S',
  'Machete',
  'Melee',
];
const CONTROL_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

const optionsSchema = z.object({
  topLimit: z.coerce.number().int().min(1).max(10).default(3),
  messageDelayMs: z.coerce.number().int().min(0).max(120000).default(10000),
  minValue: z.coerce.number().int().min(0).max(1000000).default(1),
  emptyText: z.string().max(128).default('нет данных'),
  separator: z.string().max(32).default(' | '),
  entryTemplate: z.string().max(512).default('{place}. {name} — {value}'),
  killsTitle: z.string().max(128).default('Топ по убийствам'),
  knifeKillsTitle: z.string().max(128).default('Топ по убийствам ножом'),
  revivesTitle: z.string().max(128).default('Топ медик (поднятия)'),
  deathsTitle: z.string().max(128).default('Топ смертей'),
  knifeWeapons: z
    .array(z.string().trim().min(1).max(128))
    .max(100)
    .default(DEFAULT_KNIFE_WEAPONS),
  maxMessageBytes: z.coerce.number().int().min(128).max(4096).default(1024),
  sendTimeoutMs: z.coerce.number().int().min(500).max(60000).default(5000),
  sendRetries: z.coerce.number().int().min(0).max(2).default(1),
  retryDelayMs: z.coerce.number().int().min(0).max(30000).default(2000),
});

type CounterKey = 'kills' | 'knifeKills' | 'revives' | 'deaths';

interface PlayerRoundStats {
  id: string;
  name: string;
  teamID?: string;
  kills: number;
  knifeKills: number;
  revives: number;
  deaths: number;
}

interface CombatContext {
  weapon: string;
  attackerSteamID?: string;
  attackerEOSID?: string;
  attackerPlayerController?: string;
  createdAt: number;
}

class BroadcastTimeoutError extends Error {}
class BroadcastCancelledError extends Error {}

const cleanText = (value: string): string =>
  value
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/;/g, ',')
    .replace(/\s+/g, ' ')
    .trim();

const truncateCodePoints = (value: string, maxLength: number): string =>
  [...value].slice(0, maxLength).join('');

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

const normalizeName = (name: string): string =>
  truncateCodePoints(cleanText(name), MAX_PLAYER_NAME_LENGTH) || 'Unknown';

const canonicalName = (name: string): string =>
  cleanText(name).toLocaleLowerCase('ru-RU');

const isKnifeWeapon = (weapon: string, knifeWeapons: string[]): boolean => {
  const normalizedWeapon = canonicalName(weapon);
  return knifeWeapons.some((candidate) =>
    normalizedWeapon.includes(canonicalName(candidate)),
  );
};

const namesMatch = (playerName: string, logName: string): boolean => {
  const full = canonicalName(playerName);
  const observed = canonicalName(logName);
  if (!full || !observed) return false;
  if (full === observed) return true;
  if (!full.endsWith(observed)) return false;

  const prefix = full.slice(0, -observed.length);
  return /[\s\])}>]$/.test(prefix);
};

const renderTemplate = (
  template: string,
  data: Record<'place' | 'name' | 'value', string | number>,
): string =>
  template.replace(
    /\{(place|name|value)\}/g,
    (_match, key: keyof typeof data) => String(data[key]),
  );

const playerIdentity = (player: TPlayer): string =>
  player.steamID ||
  player.eosID ||
  player.playerController ||
  `name:${canonicalName(player.name)}`;

export default definePlugin({
  name: 'roundTopsBroadcast',
  description: 'Бродкаст топов игроков в конце матча.',
  optionsSchema,
  setup({ state, options, logger, registerDisposable }) {
    const { listener, execute } = state;
    const stats = new Map<string, PlayerRoundStats>();
    const knownPlayers = new Map<string, TPlayer>();
    const combatContexts = new Map<string, CombatContext>();
    const ambiguousNameAliases = new Set<string>();
    let playersSnapshotReady = true;
    let broadcastedThisRound = false;
    let broadcastSequenceActive = false;
    let sequenceController: AbortController | null = null;
    let disposed = false;

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

    const findKnownPlayerByIDs = (ids: {
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

    const findKnownPlayerByName = (
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

    const mergeStats = (target: PlayerRoundStats, source: PlayerRoundStats) => {
      target.kills += source.kills;
      target.knifeKills += source.knifeKills;
      target.revives += source.revives;
      target.deaths += source.deaths;
    };

    const getOrCreate = (
      id: string,
      name: string,
      teamID?: string,
    ): PlayerRoundStats => {
      const cleanName = normalizeName(name);
      let item = stats.get(id);
      if (!item) {
        item = {
          id,
          name: cleanName,
          teamID,
          kills: 0,
          knifeKills: 0,
          revives: 0,
          deaths: 0,
        };
        stats.set(id, item);
      }
      item.name = cleanName;
      if (teamID) item.teamID = teamID;
      return item;
    };

    const getForPlayer = (
      player: TPlayer,
      observedNames: string[] = [],
    ): PlayerRoundStats => {
      const id = playerIdentity(player);
      let item = stats.get(id);
      const aliases = new Set([player.name, ...observedNames]);

      for (const alias of aliases) {
        const canonicalAlias = canonicalName(alias);
        if (ambiguousNameAliases.has(canonicalAlias)) continue;

        const aliasKey = `name:${canonicalAlias}`;
        const aliasItem = stats.get(aliasKey);
        if (!aliasItem || aliasItem === item) continue;

        if (item) {
          mergeStats(item, aliasItem);
          stats.delete(aliasKey);
        } else {
          stats.delete(aliasKey);
          aliasItem.id = id;
          stats.set(id, aliasItem);
          item = aliasItem;
        }
      }

      return getOrCreate(id, player.name, player.teamID);
    };

    const getForName = (name: string): PlayerRoundStats =>
      getOrCreate(`name:${canonicalName(name)}`, name);

    const cancelBroadcastSequence = () => {
      const controller = sequenceController;
      sequenceController = null;
      broadcastSequenceActive = false;
      controller?.abort();
    };

    const reset = () => {
      cancelBroadcastSequence();
      stats.clear();
      knownPlayers.clear();
      combatContexts.clear();
      ambiguousNameAliases.clear();
      playersSnapshotReady = false;
      broadcastedThisRound = false;
    };

    const onPlayersUpdated = (players: TPlayer[]) => {
      playersSnapshotReady = true;
      for (const player of players ?? []) rememberPlayer(player);
    };

    const rememberCombatContext = (
      victimName: string,
      weapon: string,
      attacker: {
        steamID?: string;
        eosID?: string;
        playerController?: string;
      },
    ) => {
      if (!victimName || !weapon) return;
      combatContexts.set(canonicalName(victimName), {
        weapon,
        attackerSteamID: attacker.steamID,
        attackerEOSID: attacker.eosID,
        attackerPlayerController: attacker.playerController,
        createdAt: Date.now(),
      });
    };

    const onPlayerDamaged = (data: TPlayerDamaged) => {
      rememberCombatContext(data.victimName, data.weapon, {
        steamID: data.attackerSteamID,
        eosID: data.attackerEOSID,
        playerController: data.attackerController,
      });
    };

    const onPlayerWounded = (data: TPlayerWounded) => {
      rememberCombatContext(data.victimName, data.weapon, {
        steamID: data.attackerSteamID,
        eosID: data.attackerEOSID,
        playerController: data.attackerPlayerController,
      });
    };

    const takeMatchingCombatContext = (
      data: TPlayerDied,
    ): CombatContext | null => {
      const key = canonicalName(data.victimName);
      const context = combatContexts.get(key);
      combatContexts.delete(key);
      if (!context || Date.now() - context.createdAt > COMBAT_CONTEXT_TTL_MS) {
        return null;
      }

      const deathHasAttackerIdentity = Boolean(
        data.attackerSteamID ||
        data.attackerEOSID ||
        data.attackerPlayerController,
      );
      if (!deathHasAttackerIdentity) return context;

      const sameAttacker =
        (Boolean(data.attackerSteamID) &&
          data.attackerSteamID === context.attackerSteamID) ||
        (Boolean(data.attackerEOSID) &&
          data.attackerEOSID === context.attackerEOSID) ||
        (Boolean(data.attackerPlayerController) &&
          data.attackerPlayerController === context.attackerPlayerController);
      return sameAttacker ? context : null;
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
          finish(() => reject(new BroadcastCancelledError('cancelled')));
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
                new BroadcastTimeoutError(`RCON timeout after ${timeoutMs}ms`),
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

    const sendBroadcast = async (
      message: string,
      signal: AbortSignal,
    ): Promise<boolean> => {
      for (let attempt = 0; attempt <= options.sendRetries; attempt++) {
        if (signal.aborted || disposed) return false;
        try {
          await withTimeout(
            adminBroadcast(execute, message),
            options.sendTimeoutMs,
            signal,
          );
          return true;
        } catch (error) {
          if (error instanceof BroadcastCancelledError) return false;

          logger.error(
            `[roundTopsBroadcast] broadcast error (${attempt + 1}/${
              options.sendRetries + 1
            }): ${String(error)}`,
          );

          // A timed-out squad-rcon request cannot be cancelled and remains in
          // its internal queue. Retrying it would only add another stuck item.
          if (
            error instanceof BroadcastTimeoutError ||
            attempt >= options.sendRetries
          ) {
            return false;
          }

          if (!(await wait(options.retryDelayMs, signal))) return false;
        }
      }
      return false;
    };

    const onPlayerDied = (data: TPlayerDied) => {
      const victimName = normalizeName(data.victimName);
      const combatContext = takeMatchingCombatContext(data);
      const victimResolution = findKnownPlayerByName(victimName);
      const victim = victimResolution.player;
      if (victimResolution.ambiguous) {
        const alias = canonicalName(victimName);
        if (!ambiguousNameAliases.has(alias)) {
          ambiguousNameAliases.add(alias);
          logger.warn(
            `[roundTopsBroadcast] ambiguous victim name, event skipped: ${victimName}`,
          );
        }
        return;
      }
      const attacker = findKnownPlayerByIDs({
        steamID: data.attackerSteamID,
        eosID: data.attackerEOSID,
        playerController: data.attackerPlayerController,
      });

      const victimStats = victim
        ? getForPlayer(victim, [victimName])
        : getForName(victimName);
      victimStats.deaths++;

      if (!attacker || !victim) return;
      if (playerIdentity(attacker) === playerIdentity(victim)) return;
      if (!attacker.teamID || !victim.teamID) return;
      if (attacker.teamID === victim.teamID) return;

      const attackerStats = getForPlayer(attacker);
      attackerStats.kills++;
      const isKnifeKill =
        isKnifeWeapon(data.weapon, options.knifeWeapons) ||
        Boolean(
          combatContext &&
          isKnifeWeapon(combatContext.weapon, options.knifeWeapons),
        );
      if (isKnifeKill) {
        attackerStats.knifeKills++;
      }
    };

    const onPlayerRevived = (data: TPlayerRevived) => {
      combatContexts.delete(canonicalName(data.victimName));
      const knownReviver = findKnownPlayerByIDs({
        steamID: data.reviverSteamID,
        eosID: data.reviverEOSID,
      });
      const reviverStats = knownReviver
        ? getForPlayer(knownReviver, [data.reviverName])
        : getOrCreate(
            data.reviverSteamID ||
              data.reviverEOSID ||
              `name:${canonicalName(data.reviverName)}`,
            data.reviverName,
          );
      reviverStats.revives++;
    };

    const topLine = (title: string, key: CounterKey): string => {
      const rows = [...stats.values()]
        .filter((item) => item[key] >= options.minValue)
        .sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name))
        .slice(0, options.topLimit);

      const body =
        rows.length > 0
          ? rows
              .map((item, index) =>
                renderTemplate(options.entryTemplate, {
                  place: index + 1,
                  name: item.name,
                  value: item[key],
                }),
              )
              .join(options.separator)
          : options.emptyText;

      return truncateUtf8(
        cleanText(`${title}: ${body}`),
        options.maxMessageBytes,
      );
    };

    const runBroadcastSequence = async (
      messages: string[],
      controller: AbortController,
    ) => {
      let allDelivered = false;
      try {
        for (let index = 0; index < messages.length; index++) {
          if (
            index > 0 &&
            !(await wait(options.messageDelayMs, controller.signal))
          ) {
            return;
          }
          if (!(await sendBroadcast(messages[index], controller.signal)))
            return;
        }
        allDelivered = true;
      } finally {
        if (sequenceController === controller) {
          sequenceController = null;
          broadcastSequenceActive = false;
          broadcastedThisRound = allDelivered;
        }
      }
    };

    const onRoundEnded = () => {
      if (broadcastedThisRound || broadcastSequenceActive || disposed) return;

      const controller = new AbortController();
      sequenceController = controller;
      broadcastSequenceActive = true;

      const messages = [
        topLine(options.killsTitle, 'kills'),
        topLine(options.knifeKillsTitle, 'knifeKills'),
        topLine(options.revivesTitle, 'revives'),
        topLine(options.deathsTitle, 'deaths'),
      ];
      void runBroadcastSequence(messages, controller);
    };

    rememberCurrentPlayers();
    listener.on(EVENTS.UPDATED_PLAYERS, onPlayersUpdated);
    listener.on(EVENTS.PLAYER_DAMAGED, onPlayerDamaged);
    listener.on(EVENTS.PLAYER_WOUNDED, onPlayerWounded);
    listener.on(EVENTS.PLAYER_DIED, onPlayerDied);
    listener.on(EVENTS.PLAYER_REVIVED, onPlayerRevived);
    listener.on(EVENTS.ROUND_ENDED, onRoundEnded);
    // Сброс должен выполниться раньше остальных обработчиков раунда, даже если
    // один из них синхронно выбросит исключение и прервёт EventEmitter.emit().
    listener.prependListener(EVENTS.NEW_GAME, reset);

    registerDisposable(() => {
      disposed = true;
      listener.off(EVENTS.UPDATED_PLAYERS, onPlayersUpdated);
      listener.off(EVENTS.PLAYER_DAMAGED, onPlayerDamaged);
      listener.off(EVENTS.PLAYER_WOUNDED, onPlayerWounded);
      listener.off(EVENTS.PLAYER_DIED, onPlayerDied);
      listener.off(EVENTS.PLAYER_REVIVED, onPlayerRevived);
      listener.off(EVENTS.ROUND_ENDED, onRoundEnded);
      listener.off(EVENTS.NEW_GAME, reset);
      cancelBroadcastSequence();
      stats.clear();
      knownPlayers.clear();
      combatContexts.clear();
      ambiguousNameAliases.clear();
    });
  },
});
