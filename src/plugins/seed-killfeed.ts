import { TPlayerDied } from 'squad-logs';
import { z } from 'zod';
import { EVENTS } from '../constants';
import { adminWarn } from '../core';
import { definePlugin } from '../core/plugin';
import { getPlayer, getPlayerByName } from './helpers';

const optionsSchema = z.object({
  seedKeyword: z.string().default('Seed'),
  seedLayers: z.union([z.string(), z.array(z.string())]).default([]),
  message: z.string().default('Ты убил противника: {victim}'),
});

const normalize = (value: string) => value.trim().toLowerCase();

const toList = (value: string | string[]): string[] =>
  (Array.isArray(value) ? value : [value]).map((v) => v.trim()).filter(Boolean);

const isSeedLayer = (
  layer: string | null | undefined,
  seedKeyword: string,
  seedLayers: string[],
): boolean => {
  if (!layer) return false;

  const normalizedLayer = normalize(layer);
  const explicitLayers = seedLayers.map(normalize);
  if (explicitLayers.includes(normalizedLayer)) return true;

  const keyword = normalize(seedKeyword);
  return keyword.length > 0 && normalizedLayer.includes(keyword);
};

const formatWeapon = (weapon: string | null | undefined): string =>
  (weapon ?? '')
    .replace(/_C(?:_\d+)?$/, '')
    .replace(/^BP_/, '')
    .trim() || 'неизвестно';

const renderMessage = (
  template: string,
  data: Record<string, string>,
): string =>
  Object.entries(data).reduce(
    (msg, [key, value]) => msg.split(`{${key}}`).join(value),
    template,
  );

export default definePlugin({
  name: 'seedKillfeed',
  description: 'AdminWarn убийце о килле противника только на seed-слоях.',
  optionsSchema,
  setup({ state, options, registerDisposable }) {
    const { listener, execute } = state;
    const { seedKeyword, message } = options;
    const seedLayers = toList(options.seedLayers);

    const onPlayerDied = (data: TPlayerDied) => {
      const layer = state.currentMap?.layer ?? '';
      if (!isSeedLayer(layer, seedKeyword, seedLayers)) return;

      const victim = getPlayerByName(state, data.victimName);
      const attacker = getPlayer(state, {
        steamID: data.attackerSteamID,
        eosID: data.attackerEOSID,
        playerController: data.attackerPlayerController,
      });

      if (!attacker || !victim) return;
      if (!attacker.steamID || attacker.steamID === victim.steamID) return;
      if (attacker.teamID === victim.teamID) return;

      const text = renderMessage(message, {
        attacker: attacker.name,
        victim: victim.name.trim(),
        weapon: formatWeapon(data.weapon),
        layer,
      });

      adminWarn(execute, attacker.steamID, text);
    };

    listener.on(EVENTS.PLAYER_DIED, onPlayerDied);
    registerDisposable(() => listener.off(EVENTS.PLAYER_DIED, onPlayerDied));
  },
});
