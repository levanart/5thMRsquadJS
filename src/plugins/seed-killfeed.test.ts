import {
  TNewGame,
  TPlayerDied,
  TPlayerRevived,
  TPlayerWounded,
} from 'squad-logs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS } from '../constants';
import { createFakeState, makePlayer } from '../test/fakes';
import { TExecute, TPlayer, TState } from '../types';
import seedKillfeed from './seed-killfeed';

const ATTACKER_STEAM = '76561198000000001';
const VICTIM_STEAM = '76561198000000002';

const attacker = (overrides: Partial<TPlayer> = {}): TPlayer =>
  makePlayer({
    name: 'Attacker',
    steamID: ATTACKER_STEAM,
    eosID: 'attacker-eos',
    playerController: 'attacker-controller',
    teamID: '1',
    ...overrides,
  });

const victim = (overrides: Partial<TPlayer> = {}): TPlayer =>
  makePlayer({
    name: 'Victim',
    steamID: VICTIM_STEAM,
    eosID: 'victim-eos',
    playerController: 'victim-controller',
    teamID: '2',
    ...overrides,
  });

const died = (overrides: Partial<TPlayerDied> = {}): TPlayerDied => ({
  raw: 'death-1',
  time: '00:00:01',
  woundTime: '00:00:00',
  chainID: '1',
  victimName: 'Victim',
  damage: 100,
  attackerPlayerController: 'attacker-controller',
  attackerEOSID: 'attacker-eos',
  attackerSteamID: ATTACKER_STEAM,
  weapon: 'BP_Rifle_C',
  event: EVENTS.PLAYER_DIED,
  ...overrides,
});

const wounded = (overrides: Partial<TPlayerWounded> = {}): TPlayerWounded => ({
  raw: 'wound-1',
  time: '00:00:00',
  chainID: '1',
  victimName: 'Victim',
  damage: 100,
  attackerPlayerController: 'attacker-controller',
  attackerEOSID: 'attacker-eos',
  attackerSteamID: ATTACKER_STEAM,
  weapon: 'BP_AK74_C',
  event: EVENTS.PLAYER_WOUNDED,
  ...overrides,
});

const revived = (overrides: Partial<TPlayerRevived> = {}): TPlayerRevived => ({
  raw: 'revive-1',
  time: '00:00:02',
  chainID: '1',
  reviverName: 'Medic',
  reviverEOSID: 'medic-eos',
  reviverSteamID: '76561198000000003',
  victimName: 'Victim',
  victimEOSID: 'victim-eos',
  victimSteamID: VICTIM_STEAM,
  event: EVENTS.PLAYER_REVIVED,
  ...overrides,
});

const newGame = (layerClassname: string): TNewGame => ({
  raw: '',
  time: '',
  chainID: '',
  dlc: 'Game',
  mapClassname: 'Map',
  layerClassname,
  event: EVENTS.NEW_GAME,
});

const setupPlugin = (
  state: TState,
  overrides: Record<string, unknown> = {},
): (() => void) => {
  const options = seedKillfeed.optionsSchema?.parse({
    retryDelayMs: 0,
    ...overrides,
  }) as Record<string, unknown>;
  let dispose = () => {};
  seedKillfeed.setup({
    state,
    options,
    logger: state.logger,
    registerDisposable: (value) => {
      dispose = typeof value === 'function' ? value : () => value.dispose();
    },
  });
  return dispose;
};

const setExecute = (state: TState, execute: TExecute) => {
  state.execute = execute;
  state.rcon.execute = execute;
};

describe('seedKillfeed', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('warns the killer on a seed layer', async () => {
    const { state, listener, commands } = createFakeState({
      players: [attacker(), victim()],
      currentMap: { level: 'Sumari', layer: 'Sumari_Seed_v1' },
    });
    setupPlugin(state);

    listener.emit(EVENTS.PLAYER_DIED, died());
    await vi.runAllTimersAsync();

    expect(commands).toEqual([
      `AdminWarn ${ATTACKER_STEAM} Ты убил противника: Victim`,
    ]);
  });

  it('supports explicit seed layers without a seed keyword', async () => {
    const { state, listener, commands } = createFakeState({
      players: [attacker(), victim()],
      currentMap: { level: 'Custom', layer: 'CustomLayer_v1' },
    });
    setupPlugin(state, {
      seedKeyword: '',
      seedLayers: ['CustomLayer_v1'],
    });

    listener.emit(EVENTS.PLAYER_DIED, died());
    await vi.runAllTimersAsync();

    expect(commands).toHaveLength(1);
  });

  it('uses NEW_GAME immediately instead of a stale currentMap', async () => {
    const players = [attacker(), victim()];
    const { state, listener, commands } = createFakeState({
      players,
      currentMap: { level: 'Sumari', layer: 'Sumari_Seed_v1' },
    });
    setupPlugin(state);

    listener.emit(EVENTS.NEW_GAME, newGame('Narva_Unseeded_v1'));
    listener.emit(EVENTS.UPDATED_PLAYERS, players);
    listener.emit(EVENTS.PLAYER_DIED, died({ raw: 'normal-layer-death' }));
    await vi.runAllTimersAsync();
    expect(commands).toHaveLength(0);

    listener.emit(EVENTS.NEW_GAME, newGame('Logar_Seed_v1'));
    listener.emit(EVENTS.UPDATED_PLAYERS, players);
    listener.emit(EVENTS.PLAYER_DIED, died({ raw: 'seed-layer-death' }));
    await vi.runAllTimersAsync();
    expect(commands).toHaveLength(1);
  });

  it('matches a unique victim when the log omits a clan tag', async () => {
    const { state, listener, commands } = createFakeState({
      players: [attacker(), victim({ name: '[TAG] Victim' })],
      currentMap: { level: 'Sumari', layer: 'Sumari_Seed_v1' },
    });
    setupPlugin(state);

    listener.emit(EVENTS.PLAYER_DIED, died());
    await vi.runAllTimersAsync();

    expect(commands[0]).toContain('[TAG] Victim');
  });

  it('does not guess when victim names are duplicated', async () => {
    const duplicateVictims = [
      victim({ name: 'Duplicate' }),
      victim({
        name: 'Duplicate',
        steamID: '76561198000000004',
        eosID: 'victim-eos-2',
        playerController: 'victim-controller-2',
      }),
    ];
    const { state, listener, commands } = createFakeState({
      players: [attacker(), ...duplicateVictims],
      currentMap: { level: 'Sumari', layer: 'Sumari_Seed_v1' },
    });
    setupPlugin(state);

    listener.emit(EVENTS.PLAYER_DIED, died({ victimName: 'Duplicate' }));
    await vi.runAllTimersAsync();

    expect(commands).toHaveLength(0);
  });

  it('ignores suicides and teamkills', async () => {
    const friendlyVictim = victim({ teamID: '1' });
    const { state, listener, commands } = createFakeState({
      players: [attacker(), friendlyVictim],
      currentMap: { level: 'Sumari', layer: 'Sumari_Seed_v1' },
    });
    setupPlugin(state);

    listener.emit(EVENTS.PLAYER_DIED, died({ raw: 'teamkill' }));
    listener.emit(
      EVENTS.PLAYER_DIED,
      died({
        raw: 'suicide',
        victimName: 'Attacker',
        attackerSteamID: ATTACKER_STEAM,
      }),
    );
    await vi.runAllTimersAsync();

    expect(commands).toHaveLength(0);
  });

  it('recovers attacker and weapon from the wound context', async () => {
    const { state, listener, commands } = createFakeState({
      players: [attacker(), victim()],
      currentMap: { level: 'Sumari', layer: 'Sumari_Seed_v1' },
    });
    setupPlugin(state, {
      message: '{attacker} убил {victim} из {weapon} на {layer}',
    });

    listener.emit(EVENTS.PLAYER_WOUNDED, wounded());
    listener.emit(
      EVENTS.PLAYER_DIED,
      died({
        attackerSteamID: '',
        attackerEOSID: '',
        attackerPlayerController: '',
        weapon: 'BP_Soldier_C',
      }),
    );
    await vi.runAllTimersAsync();

    expect(commands[0]).toContain(
      'Attacker убил Victim из AK74 на Sumari_Seed_v1',
    );
  });

  it('clears wound attribution when the victim is revived', async () => {
    const { state, listener, commands } = createFakeState({
      players: [attacker(), victim()],
      currentMap: { level: 'Sumari', layer: 'Sumari_Seed_v1' },
    });
    setupPlugin(state);

    listener.emit(EVENTS.PLAYER_WOUNDED, wounded());
    listener.emit(EVENTS.PLAYER_REVIVED, revived());
    listener.emit(
      EVENTS.PLAYER_DIED,
      died({
        attackerSteamID: '',
        attackerEOSID: '',
        attackerPlayerController: '',
      }),
    );
    await vi.runAllTimersAsync();

    expect(commands).toHaveLength(0);
  });

  it('deduplicates repeated death log lines', async () => {
    const { state, listener, commands } = createFakeState({
      players: [attacker(), victim()],
      currentMap: { level: 'Sumari', layer: 'Sumari_Seed_v1' },
    });
    setupPlugin(state);

    listener.emit(EVENTS.PLAYER_DIED, died());
    listener.emit(EVENTS.PLAYER_DIED, died());
    await vi.runAllTimersAsync();

    expect(commands).toHaveLength(1);
  });

  it('sanitizes player-controlled text and limits UTF-8 length', async () => {
    const unsafeAttacker = attacker({ name: 'Bad\n;AdminEndMatch {victim}' });
    const { state, listener, commands } = createFakeState({
      players: [unsafeAttacker, victim()],
      currentMap: { level: 'Sumari', layer: 'Sumari_Seed_v1' },
    });
    setupPlugin(state, {
      message: '{attacker} / {victim} / '.repeat(10),
      maxMessageBytes: 64,
    });

    listener.emit(EVENTS.PLAYER_DIED, died());
    await vi.runAllTimersAsync();

    const message = commands[0].slice(`AdminWarn ${ATTACKER_STEAM} `.length);
    expect(message).not.toMatch(/[\r\n;]/);
    expect(message).toContain('{victim}');
    expect(Buffer.byteLength(message, 'utf8')).toBeLessThanOrEqual(64);
  });

  it('retries a rejected warning without duplicating later warnings', async () => {
    const { state, listener } = createFakeState({
      players: [attacker(), victim()],
      currentMap: { level: 'Sumari', layer: 'Sumari_Seed_v1' },
    });
    const commands: string[] = [];
    let first = true;
    setExecute(state, (command) => {
      commands.push(command);
      if (first) {
        first = false;
        return Promise.reject(new Error('temporary failure'));
      }
      return Promise.resolve('');
    });
    setupPlugin(state, { sendRetries: 1 });

    listener.emit(EVENTS.PLAYER_DIED, died());
    await vi.runAllTimersAsync();

    expect(commands).toHaveLength(2);
    expect(commands[0]).toBe(commands[1]);
  });

  it('stops adding commands during the cooldown after an RCON timeout', async () => {
    const { state, listener } = createFakeState({
      players: [attacker(), victim()],
      currentMap: { level: 'Sumari', layer: 'Sumari_Seed_v1' },
    });
    const commands: string[] = [];
    setExecute(state, (command) => {
      commands.push(command);
      return new Promise<string>(() => {});
    });
    setupPlugin(state, {
      sendTimeoutMs: 500,
      failureCooldownMs: 1000,
    });

    listener.emit(EVENTS.PLAYER_DIED, died({ raw: 'timeout-1' }));
    await vi.advanceTimersByTimeAsync(500);
    listener.emit(EVENTS.PLAYER_DIED, died({ raw: 'timeout-2' }));
    expect(commands).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000);
    listener.emit(EVENTS.PLAYER_DIED, died({ raw: 'timeout-3' }));
    expect(commands).toHaveLength(2);
  });

  it('removes listeners and cancels queued warnings on dispose', async () => {
    const { state, listener, commands } = createFakeState({
      players: [attacker(), victim()],
      currentMap: { level: 'Sumari', layer: 'Sumari_Seed_v1' },
    });
    const dispose = setupPlugin(state);

    dispose();
    listener.emit(EVENTS.PLAYER_DIED, died());
    await vi.runAllTimersAsync();

    expect(commands).toHaveLength(0);
    expect(listener.listenerCount(EVENTS.PLAYER_DIED)).toBe(0);
    expect(listener.listenerCount(EVENTS.PLAYER_WOUNDED)).toBe(0);
    expect(listener.listenerCount(EVENTS.NEW_GAME)).toBe(0);
  });

  it('rejects unsafe configuration bounds', () => {
    const schema = seedKillfeed.optionsSchema;

    expect(schema?.safeParse({ maxQueueSize: 101 }).success).toBe(false);
    expect(schema?.safeParse({ sendTimeoutMs: 499 }).success).toBe(false);
    expect(schema?.safeParse({ message: '' }).success).toBe(false);
    expect(schema?.safeParse({ seedKeyword: '', seedLayers: [] }).success).toBe(
      false,
    );
  });
});
