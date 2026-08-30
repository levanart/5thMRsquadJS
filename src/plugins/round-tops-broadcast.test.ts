import { TPlayerDied, TPlayerRevived, TPlayerWounded } from 'squad-logs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS } from '../constants';
import { createFakeState, makePlayer } from '../test/fakes';
import { TExecute, TPlayer, TState } from '../types';
import roundTopsBroadcast from './round-tops-broadcast';

const died = (overrides: Partial<TPlayerDied> = {}): TPlayerDied => ({
  raw: '',
  time: '',
  woundTime: '',
  chainID: '',
  victimName: 'Victim',
  damage: 100,
  attackerPlayerController: 'attacker-controller',
  attackerEOSID: 'attacker-eos',
  attackerSteamID: 'attacker-steam',
  weapon: 'Rifle',
  event: EVENTS.PLAYER_DIED,
  ...overrides,
});

const wounded = (overrides: Partial<TPlayerWounded> = {}): TPlayerWounded => ({
  raw: '',
  time: '',
  chainID: '',
  victimName: 'Victim',
  damage: 100,
  attackerPlayerController: 'attacker-controller',
  attackerEOSID: 'attacker-eos',
  attackerSteamID: 'attacker-steam',
  weapon: 'BP_AK74Bayonet_C',
  event: EVENTS.PLAYER_WOUNDED,
  ...overrides,
});

const revived = (overrides: Partial<TPlayerRevived> = {}): TPlayerRevived => ({
  raw: '',
  time: '',
  chainID: '',
  reviverName: 'Medic',
  reviverEOSID: 'medic-eos',
  reviverSteamID: 'medic-steam',
  victimName: 'Victim',
  victimEOSID: 'victim-eos',
  victimSteamID: 'victim-steam',
  event: EVENTS.PLAYER_REVIVED,
  ...overrides,
});

const setupPlugin = (
  state: TState,
  optionOverrides: Record<string, unknown> = {},
): (() => void) => {
  const options = roundTopsBroadcast.optionsSchema?.parse({
    messageDelayMs: 0,
    retryDelayMs: 0,
    ...optionOverrides,
  }) as Record<string, unknown>;
  let dispose = () => {};

  roundTopsBroadcast.setup({
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

describe('roundTopsBroadcast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('publishes kills, knife kills, revives and deaths sequentially', async () => {
    const attacker = makePlayer({
      name: 'Attacker',
      steamID: 'attacker-steam',
      eosID: 'attacker-eos',
      playerController: 'attacker-controller',
      teamID: '1',
    });
    const victim = makePlayer({
      name: 'Victim',
      steamID: 'victim-steam',
      eosID: 'victim-eos',
      teamID: '2',
    });
    const medic = makePlayer({
      name: 'Medic',
      steamID: 'medic-steam',
      eosID: 'medic-eos',
      teamID: '1',
    });
    const { state, listener, commands } = createFakeState({
      players: [attacker, victim, medic],
    });
    setupPlugin(state);

    listener.emit(EVENTS.PLAYER_DIED, died());
    listener.emit(EVENTS.PLAYER_REVIVED, revived());
    listener.emit(EVENTS.ROUND_ENDED);
    await vi.runAllTimersAsync();

    expect(commands).toHaveLength(4);
    expect(commands[0]).toContain('Attacker — 1');
    expect(commands[1]).toContain('нет данных');
    expect(commands[2]).toContain('Medic — 1');
    expect(commands[3]).toContain('Victim — 1');
  });

  it('counts a knife kill from the matching wound context', async () => {
    const attacker = makePlayer({
      name: 'Attacker',
      steamID: 'attacker-steam',
      eosID: 'attacker-eos',
      playerController: 'attacker-controller',
      teamID: '1',
    });
    const victim = makePlayer({
      name: 'Victim',
      steamID: 'victim-steam',
      eosID: 'victim-eos',
      teamID: '2',
    });
    const { state, listener, commands } = createFakeState({
      players: [attacker, victim],
    });
    setupPlugin(state);

    listener.emit(EVENTS.PLAYER_WOUNDED, wounded());
    listener.emit(EVENTS.PLAYER_DIED, died({ weapon: 'BP_Soldier_RUS_C' }));
    listener.emit(EVENTS.ROUND_ENDED);
    await vi.runAllTimersAsync();

    expect(commands[1]).toContain('Attacker — 1');
  });

  it('counts a knife kill reported directly by the death event', async () => {
    const attacker = makePlayer({
      name: 'Attacker',
      steamID: 'attacker-steam',
      eosID: 'attacker-eos',
      playerController: 'attacker-controller',
      teamID: '1',
    });
    const victim = makePlayer({
      name: 'Victim',
      steamID: 'victim-steam',
      eosID: 'victim-eos',
      teamID: '2',
    });
    const { state, listener, commands } = createFakeState({
      players: [attacker, victim],
    });
    setupPlugin(state);

    listener.emit(EVENTS.PLAYER_DIED, died({ weapon: 'BP_Knife_M9_C' }));
    listener.emit(EVENTS.ROUND_ENDED);
    await vi.runAllTimersAsync();

    expect(commands[1]).toContain('Attacker — 1');
  });

  it('does not reuse knife context after the victim is revived', async () => {
    const attacker = makePlayer({
      name: 'Attacker',
      steamID: 'attacker-steam',
      eosID: 'attacker-eos',
      playerController: 'attacker-controller',
      teamID: '1',
    });
    const victim = makePlayer({
      name: 'Victim',
      steamID: 'victim-steam',
      eosID: 'victim-eos',
      teamID: '2',
    });
    const { state, listener, commands } = createFakeState({
      players: [attacker, victim],
    });
    setupPlugin(state);

    listener.emit(EVENTS.PLAYER_WOUNDED, wounded());
    listener.emit(EVENTS.PLAYER_REVIVED, revived());
    listener.emit(EVENTS.PLAYER_DIED, died({ weapon: 'BP_Rifle_C' }));
    listener.emit(EVENTS.ROUND_ENDED);
    await vi.runAllTimersAsync();

    expect(commands[1]).toContain('нет данных');
  });

  it('matches a unique victim when the log omits a clan tag', async () => {
    const attacker = makePlayer({
      name: 'Attacker',
      steamID: 'attacker-steam',
      eosID: 'attacker-eos',
      playerController: 'attacker-controller',
      teamID: '1',
    });
    const victim = makePlayer({
      name: '[TAG] Victim',
      steamID: 'victim-steam',
      eosID: 'victim-eos',
      teamID: '2',
    });
    const { state, listener, commands } = createFakeState({
      players: [attacker, victim],
    });
    setupPlugin(state);

    listener.emit(EVENTS.PLAYER_DIED, died({ victimName: 'Victim' }));
    listener.emit(EVENTS.ROUND_ENDED);
    await vi.runAllTimersAsync();

    expect(commands[0]).toContain('Attacker — 1');
    expect(commands[3]).toContain('[TAG] Victim — 1');
  });

  it('does not guess a victim when display names are duplicated', async () => {
    const attacker = makePlayer({
      name: 'Attacker',
      steamID: 'attacker-steam',
      eosID: 'attacker-eos',
      playerController: 'attacker-controller',
      teamID: '1',
    });
    const victims: TPlayer[] = [
      makePlayer({
        name: 'Duplicate',
        steamID: 'victim-1',
        eosID: 'victim-eos-1',
        teamID: '2',
      }),
      makePlayer({
        name: 'Duplicate',
        steamID: 'victim-2',
        eosID: 'victim-eos-2',
        teamID: '2',
      }),
    ];
    const { state, listener, commands } = createFakeState({
      players: [attacker, ...victims],
    });
    setupPlugin(state);

    listener.emit(EVENTS.PLAYER_DIED, died({ victimName: 'Duplicate' }));
    listener.emit(EVENTS.ROUND_ENDED);
    await vi.runAllTimersAsync();

    expect(commands[0]).toContain('нет данных');
    expect(commands[3]).toContain('нет данных');
  });

  it('excludes suicides and teamkills from kills while retaining deaths', async () => {
    const attacker = makePlayer({
      name: 'Attacker',
      steamID: 'attacker-steam',
      eosID: 'attacker-eos',
      playerController: 'attacker-controller',
      teamID: '1',
    });
    const teammate = makePlayer({
      name: 'Teammate',
      steamID: 'teammate-steam',
      eosID: 'teammate-eos',
      teamID: '1',
    });
    const { state, listener, commands } = createFakeState({
      players: [attacker, teammate],
    });
    setupPlugin(state);

    listener.emit(
      EVENTS.PLAYER_DIED,
      died({ victimName: 'Teammate', weapon: 'BP_Knife_C' }),
    );
    listener.emit(
      EVENTS.PLAYER_DIED,
      died({
        victimName: 'Attacker',
        attackerSteamID: attacker.steamID,
        attackerEOSID: attacker.eosID,
      }),
    );
    listener.emit(EVENTS.ROUND_ENDED);
    await vi.runAllTimersAsync();

    expect(commands[0]).toContain('нет данных');
    expect(commands[1]).toContain('нет данных');
    expect(commands[3]).toContain('Attacker — 1');
    expect(commands[3]).toContain('Teammate — 1');
  });

  it('merges an earlier name-only death after the player is identified', async () => {
    const victim = makePlayer({
      name: '[TAG] Victim',
      steamID: 'victim-steam',
      eosID: 'victim-eos',
      teamID: '2',
    });
    const { state, listener, commands } = createFakeState({ players: [] });
    setupPlugin(state);

    listener.emit(EVENTS.PLAYER_DIED, died({ victimName: 'Victim' }));
    state.players = [victim];
    listener.emit(EVENTS.UPDATED_PLAYERS, [victim]);
    listener.emit(EVENTS.PLAYER_DIED, died({ victimName: 'Victim' }));
    listener.emit(EVENTS.ROUND_ENDED);
    await vi.runAllTimersAsync();

    expect(commands[3]).toContain('[TAG] Victim — 2');
    expect(commands[3].match(/Victim/g)).toHaveLength(1);
  });

  it('cancels old-round messages and allows the next round to publish', async () => {
    const { state, listener, commands } = createFakeState();
    setupPlugin(state, { messageDelayMs: 1000 });

    listener.emit(EVENTS.ROUND_ENDED);
    await vi.advanceTimersByTimeAsync(0);
    expect(commands).toHaveLength(1);

    listener.emit(EVENTS.NEW_GAME);
    await vi.advanceTimersByTimeAsync(5000);
    expect(commands).toHaveLength(1);

    listener.emit(EVENTS.UPDATED_PLAYERS, state.players);
    listener.emit(EVENTS.ROUND_ENDED);
    await vi.advanceTimersByTimeAsync(3500);
    expect(commands).toHaveLength(5);
  });

  it('sanitizes control characters and does one-pass template replacement', async () => {
    const attacker = makePlayer({
      name: 'Bad\n;AdminEndMatch {value}',
      steamID: 'attacker-steam',
      eosID: 'attacker-eos',
      playerController: 'attacker-controller',
      teamID: '1',
    });
    const victim = makePlayer({
      name: 'Victim',
      steamID: 'victim-steam',
      eosID: 'victim-eos',
      teamID: '2',
    });
    const { state, listener, commands } = createFakeState({
      players: [attacker, victim],
    });
    setupPlugin(state);

    listener.emit(EVENTS.PLAYER_DIED, died());
    listener.emit(EVENTS.ROUND_ENDED);
    await vi.runAllTimersAsync();

    expect(commands[0]).not.toMatch(/[\r\n;]/);
    expect(commands[0]).toContain('{value}');
  });

  it('limits generated messages by UTF-8 byte length', async () => {
    const { state, listener, commands } = createFakeState();
    setupPlugin(state, {
      maxMessageBytes: 128,
      killsTitle: 'Очень длинный заголовок '.repeat(5),
    });

    listener.emit(EVENTS.ROUND_ENDED);
    await vi.runAllTimersAsync();

    const message = commands[0].slice('AdminBroadcast '.length);
    expect(Buffer.byteLength(message, 'utf8')).toBeLessThanOrEqual(128);
  });

  it('retries rejected sends, but does not duplicate successful messages', async () => {
    const { state, listener } = createFakeState();
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

    listener.emit(EVENTS.ROUND_ENDED);
    await vi.runAllTimersAsync();

    expect(commands).toHaveLength(5);
    expect(commands[0]).toBe(commands[1]);
  });

  it('times out a stuck send and permits a later round-end retry', async () => {
    const { state, listener } = createFakeState();
    const commands: string[] = [];
    setExecute(state, (command) => {
      commands.push(command);
      return new Promise<string>(() => {});
    });
    setupPlugin(state, { sendTimeoutMs: 500, sendRetries: 2 });

    listener.emit(EVENTS.ROUND_ENDED);
    expect(commands).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);

    listener.emit(EVENTS.ROUND_ENDED);
    expect(commands).toHaveLength(2);
  });

  it('removes listeners and pending timers on dispose', async () => {
    const { state, listener, commands } = createFakeState();
    const dispose = setupPlugin(state, { messageDelayMs: 1000 });

    listener.emit(EVENTS.ROUND_ENDED);
    await vi.advanceTimersByTimeAsync(0);
    dispose();
    await vi.advanceTimersByTimeAsync(5000);

    expect(commands).toHaveLength(1);
    expect(listener.listenerCount(EVENTS.PLAYER_WOUNDED)).toBe(0);
    expect(listener.listenerCount(EVENTS.PLAYER_DIED)).toBe(0);
    expect(listener.listenerCount(EVENTS.NEW_GAME)).toBe(0);
  });

  it('rejects unsafe configuration bounds', () => {
    const schema = roundTopsBroadcast.optionsSchema;

    expect(schema?.safeParse({ topLimit: 11 }).success).toBe(false);
    expect(schema?.safeParse({ messageDelayMs: 120001 }).success).toBe(false);
    expect(schema?.safeParse({ maxMessageBytes: 4097 }).success).toBe(false);
    expect(schema?.safeParse({ knifeWeapons: [''] }).success).toBe(false);
  });
});
