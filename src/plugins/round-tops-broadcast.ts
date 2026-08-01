import { TPlayerDied, TPlayerRevived } from 'squad-logs';
import { z } from 'zod';
import { EVENTS } from '../constants';
import { adminBroadcast } from '../core';
import { definePlugin } from '../core/plugin';
import { TPlayer } from '../types';
import { getPlayer, getPlayerByName, getPlayerBySteamID } from './helpers';

const optionsSchema = z.object({
  topLimit: z.coerce.number().int().positive().default(3),
  messageDelayMs: z.coerce.number().int().nonnegative().default(10000),
  minValue: z.coerce.number().int().nonnegative().default(1),
  emptyText: z.string().default('нет данных'),
  separator: z.string().default(' | '),
  entryTemplate: z.string().default('{place}. {name} — {value}'),
  killsTitle: z.string().default('Топ по убийствам'),
  revivesTitle: z.string().default('Топ медик (поднятия)'),
  deathsTitle: z.string().default('Топ смертей'),
});

type CounterKey = 'kills' | 'revives' | 'deaths';

interface PlayerRoundStats {
  id: string;
  name: string;
  teamID?: string;
  kills: number;
  revives: number;
  deaths: number;
}

const normalizeName = (name: string) => name.trim() || 'Unknown';

const renderTemplate = (
  template: string,
  data: Record<string, string | number>,
): string =>
  Object.entries(data).reduce(
    (msg, [key, value]) => msg.split(`{${key}}`).join(String(value)),
    template,
  );

export default definePlugin({
  name: 'roundTopsBroadcast',
  description: 'Бродкаст топов игроков в конце матча.',
  optionsSchema,
  setup({ state, options, logger, registerDisposable }) {
    const { listener, execute } = state;
    const stats = new Map<string, PlayerRoundStats>();
    const broadcastTimers = new Set<ReturnType<typeof setTimeout>>();
    let broadcastedThisRound = false;
    let broadcastSequenceActive = false;
    let newGameDuringBroadcast = false;

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
          revives: 0,
          deaths: 0,
        };
        stats.set(id, item);
      }
      item.name = cleanName;
      if (teamID) item.teamID = teamID;
      return item;
    };

    const getForPlayer = (player: TPlayer): PlayerRoundStats =>
      getOrCreate(
        player.steamID || `name:${player.name}`,
        player.name,
        player.teamID,
      );

    const getForName = (name: string): PlayerRoundStats =>
      getOrCreate(`name:${normalizeName(name)}`, name);

    const reset = () => {
      stats.clear();
      if (broadcastSequenceActive) {
        newGameDuringBroadcast = true;
        return;
      }
      broadcastedThisRound = false;
      newGameDuringBroadcast = false;
    };

    const clearBroadcastTimers = () => {
      for (const timer of broadcastTimers) {
        clearTimeout(timer);
      }
      broadcastTimers.clear();
      broadcastSequenceActive = false;
      newGameDuringBroadcast = false;
    };

    const finishBroadcastSequence = () => {
      broadcastSequenceActive = false;
      if (newGameDuringBroadcast) {
        broadcastedThisRound = false;
        newGameDuringBroadcast = false;
      }
    };

    const sendBroadcast = (message: string) => {
      void adminBroadcast(execute, message).catch((e) => {
        logger.error(`[roundTopsBroadcast] broadcast error: ${String(e)}`);
      });
    };

    const scheduleBroadcast = (
      message: string,
      index: number,
      messages: string[],
    ) => {
      const isLastMessage = index === messages.length - 1;
      const sendAndFinishIfNeeded = () => {
        sendBroadcast(message);
        if (isLastMessage) finishBroadcastSequence();
      };
      const delayMs = index * options.messageDelayMs;
      if (delayMs <= 0) {
        sendAndFinishIfNeeded();
        return;
      }

      const timer = setTimeout(() => {
        broadcastTimers.delete(timer);
        sendAndFinishIfNeeded();
      }, delayMs);
      broadcastTimers.add(timer);
    };

    const onPlayerDied = (data: TPlayerDied) => {
      const victimName = normalizeName(data.victimName);
      const victim = getPlayerByName(state, victimName);
      const attacker = getPlayer(state, {
        steamID: data.attackerSteamID,
        eosID: data.attackerEOSID,
        playerController: data.attackerPlayerController,
      });

      const victimStats = victim
        ? getForPlayer(victim)
        : getForName(victimName);
      victimStats.deaths++;

      if (!attacker || !victim) return;
      if (!attacker.steamID || attacker.steamID === victim.steamID) return;
      if (attacker.teamID === victim.teamID) return;

      const attackerStats = getForPlayer(attacker);
      attackerStats.kills++;
    };

    const onPlayerRevived = (data: TPlayerRevived) => {
      const reviver = getPlayerBySteamID(state, data.reviverSteamID);
      const reviverStats = reviver
        ? getForPlayer(reviver)
        : getOrCreate(
            data.reviverSteamID || `name:${data.reviverName}`,
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

      return `${title}: ${body}`;
    };

    const onRoundEnded = () => {
      if (broadcastedThisRound || broadcastSequenceActive) return;
      broadcastedThisRound = true;
      broadcastSequenceActive = true;
      newGameDuringBroadcast = false;

      [
        topLine(options.killsTitle, 'kills'),
        topLine(options.revivesTitle, 'revives'),
        topLine(options.deathsTitle, 'deaths'),
      ].forEach(scheduleBroadcast);
    };

    listener.on(EVENTS.PLAYER_DIED, onPlayerDied);
    listener.on(EVENTS.PLAYER_REVIVED, onPlayerRevived);
    listener.on(EVENTS.ROUND_ENDED, onRoundEnded);
    listener.on(EVENTS.NEW_GAME, reset);

    registerDisposable(() => {
      listener.off(EVENTS.PLAYER_DIED, onPlayerDied);
      listener.off(EVENTS.PLAYER_REVIVED, onPlayerRevived);
      listener.off(EVENTS.ROUND_ENDED, onRoundEnded);
      listener.off(EVENTS.NEW_GAME, reset);
      clearBroadcastTimers();
      reset();
    });
  },
});
