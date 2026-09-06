import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS } from '../constants';
import { createFakeState } from '../test/fakes';
import { TExecute, TState } from '../types';
import seed from './seed';

const setupPlugin = (
  state: TState,
  optionOverrides: Record<string, unknown> = {},
): (() => void) => {
  const options = seed.optionsSchema?.parse({
    playerThreshold: 1,
    seedLayers: ['Sumari_Seed_v1'],
    mode: 'next',
    countdownMs: 0,
    broadcastEnabled: false,
    ...optionOverrides,
  }) as Record<string, unknown>;
  let dispose = () => {};

  seed.setup({
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

describe('seed', () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('marks a round as handled only after a successful RCON command', async () => {
    const { state, listener } = createFakeState({
      players: [],
      currentMap: { level: 'Narva', layer: 'Narva_RAAS_v1' },
      nextMap: { level: 'Gorodok', layer: 'Gorodok_RAAS_v1' },
    });
    const execute = vi.fn<TExecute>().mockResolvedValue('');
    setExecute(state, execute);
    setupPlugin(state);

    listener.emit(EVENTS.UPDATED_PLAYERS);
    await vi.advanceTimersByTimeAsync(0);
    listener.emit(EVENTS.UPDATED_PLAYERS);
    await vi.advanceTimersByTimeAsync(0);

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith('AdminSetNextLayer Sumari_Seed_v1');
  });

  it('allows another attempt in the same round after an RCON failure', async () => {
    const { state, listener } = createFakeState({
      players: [],
      currentMap: { level: 'Narva', layer: 'Narva_RAAS_v1' },
      nextMap: { level: 'Gorodok', layer: 'Gorodok_RAAS_v1' },
    });
    const execute = vi
      .fn<TExecute>()
      .mockRejectedValueOnce(new Error('RCON unavailable'))
      .mockResolvedValueOnce('');
    setExecute(state, execute);
    setupPlugin(state);

    listener.emit(EVENTS.UPDATED_PLAYERS);
    await vi.advanceTimersByTimeAsync(0);
    listener.emit(EVENTS.UPDATED_PLAYERS);
    await vi.advanceTimersByTimeAsync(0);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(
      1,
      'AdminSetNextLayer Sumari_Seed_v1',
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      'AdminSetNextLayer Sumari_Seed_v1',
    );
  });

  it('does not start a second command while the first one is pending', async () => {
    const { state, listener } = createFakeState({
      players: [],
      currentMap: { level: 'Narva', layer: 'Narva_RAAS_v1' },
      nextMap: { level: 'Gorodok', layer: 'Gorodok_RAAS_v1' },
    });
    let resolveCommand: (value: string) => void = () => undefined;
    const pendingCommand = new Promise<string>((resolve) => {
      resolveCommand = resolve;
    });
    const execute = vi.fn<TExecute>().mockReturnValue(pendingCommand);
    setExecute(state, execute);
    setupPlugin(state);

    listener.emit(EVENTS.UPDATED_PLAYERS);
    listener.emit(EVENTS.UPDATED_PLAYERS);

    expect(execute).toHaveBeenCalledOnce();

    resolveCommand('');
    await vi.advanceTimersByTimeAsync(0);
  });

  it('uses AdminChangeLayer in immediate mode', async () => {
    const { state, listener } = createFakeState({
      players: [],
      currentMap: { level: 'Narva', layer: 'Narva_RAAS_v1' },
    });
    const execute = vi.fn<TExecute>().mockResolvedValue('');
    setExecute(state, execute);
    setupPlugin(state, { mode: 'now' });

    listener.emit(EVENTS.UPDATED_PLAYERS);
    await vi.advanceTimersByTimeAsync(0);

    expect(execute).toHaveBeenCalledWith('AdminChangeLayer Sumari_Seed_v1');
  });
});
