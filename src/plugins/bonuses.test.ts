import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS } from '../constants';
import { createFakeState, makePlayer } from '../test/fakes';
import { TPlayer, TState } from '../types';

const dbMocks = vi.hoisted(() => ({
  createUser: vi.fn(),
  awardMinute: vi.fn(),
}));

vi.mock('../rnsdb', () => ({
  createUserIfNullableOrUpdateName: dbMocks.createUser,
  awardUserBonusesForMinute: dbMocks.awardMinute,
}));

import bonuses, { isSeedBonusLayer } from './bonuses';

const player = (id: number): TPlayer =>
  makePlayer({
    name: `Player ${id}`,
    steamID: `7656119800000000${id}`,
    eosID: `eos-${id}`,
  });

const setupPlugin = (
  state: TState,
  overrides: Record<string, unknown> = {},
): (() => void) => {
  const options = bonuses.optionsSchema?.parse({
    classicBonus: 1,
    seedBonus: 3,
    minPlayers: 0,
    maxPlayersOnSeed: 0,
    seedKeyword: 'Seed',
    seedLayers: [],
    ...overrides,
  }) as Record<string, unknown>;
  let dispose = () => {};

  bonuses.setup({
    state,
    options,
    logger: state.logger,
    registerDisposable: (value) => {
      dispose = typeof value === 'function' ? value : () => value.dispose();
    },
  });

  return dispose;
};

describe('bonuses', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T09:00:00.000Z'));
    dbMocks.createUser.mockReset().mockResolvedValue(true);
    dbMocks.awardMinute.mockReset().mockResolvedValue('awarded');
  });

  afterEach(() => vi.useRealTimers());

  it('strictly validates economy and player-limit options', () => {
    const schema = bonuses.optionsSchema;
    const defaults = schema?.parse({});

    expect(defaults?.minPlayers).toBe(0);
    expect(defaults?.maxPlayersOnSeed).toBe(0);
    expect(schema?.safeParse({ classicBonus: -1 }).success).toBe(false);
    expect(schema?.safeParse({ seedBonus: 0.5 }).success).toBe(false);
    expect(schema?.safeParse({ classicBonus: 1001 }).success).toBe(false);
    expect(schema?.safeParse({ minPlayers: 201 }).success).toBe(false);
    expect(schema?.safeParse({ maxPlayersOnSeed: 201 }).success).toBe(false);
    expect(
      schema?.safeParse({ minPlayers: 20, maxPlayersOnSeed: 20 }).success,
    ).toBe(false);
    expect(
      schema?.safeParse({ minPlayers: 20, maxPlayersOnSeed: 21 }).success,
    ).toBe(true);
  });

  it('recognizes seed by an exact keyword token or explicit layer', () => {
    expect(isSeedBonusLayer('Narva_Seed_v1', 'Seed', [])).toBe(true);
    expect(isSeedBonusLayer('Narva_Seeded_v1', 'Seed', [])).toBe(false);
    expect(isSeedBonusLayer('CustomLayer_v1', 'Seed', ['customlayer_v1'])).toBe(
      true,
    );
  });

  it('creates players already online and awards one classic minute', async () => {
    const online = player(1);
    const { state } = createFakeState({
      players: [online],
      currentMap: { level: 'Narva', layer: 'Narva_RAAS_v1' },
    });
    setupPlugin(state);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(dbMocks.awardMinute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(dbMocks.createUser).toHaveBeenCalledWith(
      state.id,
      online.steamID,
      online.name,
      online.eosID,
    );
    expect(dbMocks.awardMinute).toHaveBeenCalledOnce();
    expect(dbMocks.awardMinute).toHaveBeenCalledWith(
      state.id,
      expect.objectContaining({
        steamID: online.steamID,
        baseBonus: 1,
        isSeed: false,
      }),
    );
  });

  it('uses the seed amount on a seed layer', async () => {
    const { state } = createFakeState({
      players: [player(1)],
      currentMap: { level: 'Narva', layer: 'Narva_Seed_v1' },
    });
    setupPlugin(state);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(dbMocks.awardMinute).toHaveBeenCalledWith(
      state.id,
      expect.objectContaining({ baseBonus: 3, isSeed: true }),
    );
  });

  it('waits for the minimum player count and then a full minute', async () => {
    const first = player(1);
    const second = player(2);
    const { state, listener } = createFakeState({
      players: [first],
      currentMap: { level: 'Narva', layer: 'Narva_RAAS_v1' },
    });
    setupPlugin(state, { minPlayers: 2 });

    await vi.advanceTimersByTimeAsync(120_000);
    expect(dbMocks.awardMinute).not.toHaveBeenCalled();

    state.players = [first, second];
    listener.emit(EVENTS.UPDATED_PLAYERS, state.players);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(dbMocks.awardMinute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(dbMocks.awardMinute).toHaveBeenCalledTimes(2);
  });

  it('stops at the seed maximum but keeps classic accrual active', async () => {
    const { state } = createFakeState({
      players: [player(1), player(2)],
      currentMap: { level: 'Narva', layer: 'Narva_Seed_v1' },
    });
    setupPlugin(state, { maxPlayersOnSeed: 2 });

    await vi.advanceTimersByTimeAsync(120_000);
    expect(dbMocks.awardMinute).not.toHaveBeenCalled();

    state.currentMap = { level: 'Narva', layer: 'Narva_RAAS_v1' };
    await vi.advanceTimersByTimeAsync(60_000);
    expect(dbMocks.awardMinute).toHaveBeenCalledTimes(2);
    expect(dbMocks.awardMinute).toHaveBeenCalledWith(
      state.id,
      expect.objectContaining({ isSeed: false }),
    );
  });

  it('does not award while the current layer is unknown', async () => {
    const { state } = createFakeState({ players: [player(1)] });
    setupPlugin(state);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(dbMocks.awardMinute).not.toHaveBeenCalled();
  });

  it('removes a disconnected player immediately', async () => {
    const online = player(1);
    const { state, listener } = createFakeState({
      players: [online],
      currentMap: { level: 'Narva', layer: 'Narva_RAAS_v1' },
    });
    setupPlugin(state);

    await vi.advanceTimersByTimeAsync(30_000);
    listener.emit(EVENTS.PLAYER_DISCONNECTED, {
      eosID: online.eosID,
      playerController: online.playerController,
    });
    await vi.advanceTimersByTimeAsync(90_000);

    expect(dbMocks.awardMinute).not.toHaveBeenCalled();
  });

  it('resets partial time when a new game starts', async () => {
    const { state, listener } = createFakeState({
      players: [player(1)],
      currentMap: { level: 'Narva', layer: 'Narva_RAAS_v1' },
    });
    setupPlugin(state);

    await vi.advanceTimersByTimeAsync(55_000);
    listener.emit(EVENTS.NEW_GAME);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(dbMocks.awardMinute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(dbMocks.awardMinute).toHaveBeenCalledOnce();
  });

  it('handles a database failure and safely retries the due minute', async () => {
    dbMocks.awardMinute
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce('awarded');
    const { state } = createFakeState({
      players: [player(1)],
      currentMap: { level: 'Narva', layer: 'Narva_RAAS_v1' },
    });
    const errorSpy = vi.spyOn(state.logger, 'error');
    setupPlugin(state);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(dbMocks.awardMinute).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(dbMocks.awardMinute).toHaveBeenCalledTimes(2);
  });

  it('recreates a user removed between accrual cycles', async () => {
    dbMocks.awardMinute
      .mockResolvedValueOnce('missing-user')
      .mockResolvedValueOnce('awarded');
    const { state } = createFakeState({
      players: [player(1)],
      currentMap: { level: 'Narva', layer: 'Narva_RAAS_v1' },
    });
    setupPlugin(state);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(dbMocks.createUser).toHaveBeenCalledTimes(2);
    expect(dbMocks.awardMinute).toHaveBeenCalledTimes(2);
  });

  it('clears its scheduler and listeners on dispose', async () => {
    const { state, listener } = createFakeState({
      players: [player(1)],
      currentMap: { level: 'Narva', layer: 'Narva_RAAS_v1' },
    });
    const dispose = setupPlugin(state);
    await vi.advanceTimersByTimeAsync(0);

    dispose();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(dbMocks.awardMinute).not.toHaveBeenCalled();
    expect(listener.listenerCount(EVENTS.PLAYER_CONNECTED)).toBe(0);
    expect(listener.listenerCount(EVENTS.PLAYER_DISCONNECTED)).toBe(0);
    expect(listener.listenerCount(EVENTS.UPDATED_PLAYERS)).toBe(0);
    expect(listener.listenerCount(EVENTS.NEW_GAME)).toBe(0);
  });
});
