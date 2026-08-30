import {
  TPlayerConnected,
  TPlayerDamaged,
  TPlayerPossess,
  TTickRate,
} from 'squad-logs';
import { UPDATE_TIMEOUT } from '../../constants';
import { getServersState } from '../../serversState';
import { TGetAdmins } from '../../types';
import { EVENTS } from './../../constants';
import { updateAdmins } from './updateAdmins';
import { updateCurrentMap } from './updateCurrentMap';
import { updateNextMap } from './updateNextMap';
import { updatePlayers } from './updatePlayers';
import { updateServerInfo } from './updateServerInfo';
import { updateSquads } from './updateSquads';

export const initState = async (id: number, getAdmins: TGetAdmins) => {
  await updateAdmins(id, getAdmins);
  await updateCurrentMap(id);
  await updateNextMap(id);
  await updatePlayers(id);
  await updateSquads(id);
  await updateServerInfo(id);

  const state = getServersState(id);
  const { coreListener, listener } = state;

  let updateTimeout: NodeJS.Timeout;
  let canRunUpdateInterval = true;
  setInterval(async () => {
    if (!canRunUpdateInterval) return;
    await updatePlayers(id);
    await updateSquads(id);
  }, UPDATE_TIMEOUT);

  const updatesOnEvents = async () => {
    canRunUpdateInterval = false;
    clearTimeout(updateTimeout);
    await updatePlayers(id);
    await updateSquads(id);
    updateTimeout = setTimeout(
      () => (canRunUpdateInterval = true),
      UPDATE_TIMEOUT,
    );
  };

  for (const key in EVENTS) {
    const event = EVENTS[key as keyof typeof EVENTS];
    coreListener.on(event, async (data) => {
      try {
        if (
          event === EVENTS.PLAYER_CONNECTED ||
          event === EVENTS.SQUAD_CREATED
        ) {
          await updatesOnEvents();

          if (event === EVENTS.PLAYER_CONNECTED) {
            const player = data as TPlayerConnected;
            const p = state.players?.find((x) => x.steamID === player?.steamID);
            if (p) p.playerController = player.playerController;
          }
        }

        if (event === EVENTS.NEW_GAME) {
          // Раундовые плагины должны сброситься до любых RCON/файловых
          // обновлений. Иначе события начала нового матча успевают попасть в
          // состояние прошлого раунда, а ошибка обновления подавляет NEW_GAME.
          try {
            listener.emit(event, data);
          } catch (err) {
            state.logger.error(`Ошибка обработчика NEW_GAME: ${String(err)}`);
          }

          const refreshes: Array<[string, () => Promise<unknown>]> = [
            ['players', () => updatePlayers(id)],
            ['squads', () => updateSquads(id)],
            ['current map', () => updateCurrentMap(id)],
            ['next map', () => updateNextMap(id)],
            ['server info', () => updateServerInfo(id)],
            ['admins', () => updateAdmins(id, getAdmins)],
          ];

          for (const [name, refresh] of refreshes) {
            try {
              await refresh();
            } catch (err) {
              state.logger.error(
                `Ошибка обновления ${name} после NEW_GAME: ${String(err)}`,
              );
            }
          }
          return;
        }

        if (event === EVENTS.TICK_RATE) {
          state.tickRate = (data as TTickRate).tickRate;
        }

        if (event === EVENTS.PLAYER_POSSESS) {
          const player = data as TPlayerPossess;
          const p = state.players?.find((x) => x.steamID === player?.steamID);
          if (p) p.possess = player.possessClassname;
        }

        if (event === EVENTS.PLAYER_DAMAGED) {
          const player = data as TPlayerDamaged;
          const p = state.players?.find((x) => x.name === player?.victimName);
          if (p) p.weapon = player.weapon;
        }

        listener.emit(event, data);
      } catch (err) {
        state.logger.error(`Ошибка обработки события ${event}: ${String(err)}`);
      }
    });
  }
};
