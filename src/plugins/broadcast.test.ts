import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeState, makePlayer } from '../test/fakes';
import { TState } from '../types';
import broadcast from './broadcast';

const setupPlugin = (
  state: TState,
  texts: string[],
  interval = 1000,
): (() => void) => {
  const options = broadcast.optionsSchema?.parse({ texts, interval }) as Record<
    string,
    unknown
  >;
  let dispose = () => {};

  broadcast.setup({
    state,
    options,
    logger: state.logger,
    registerDisposable: (value) => {
      dispose = typeof value === 'function' ? value : () => value.dispose();
    },
  });

  return dispose;
};

describe('broadcast', () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('does not start broadcasting when all messages are empty', async () => {
    const { state, commands } = createFakeState({ players: [makePlayer()] });

    setupPlugin(state, ['', '   ', '\n\t']);
    await vi.advanceTimersByTimeAsync(5000);

    expect(commands).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('trims messages, skips empty entries and rotates valid messages', async () => {
    const { state, commands } = createFakeState({ players: [makePlayer()] });
    const dispose = setupPlugin(state, ['  Первое  ', '', '   ', 'Второе']);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(commands).toEqual([
      'AdminBroadcast Первое',
      'AdminBroadcast Второе',
      'AdminBroadcast Первое',
    ]);

    dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for players before advancing to the next message', async () => {
    const { state, commands } = createFakeState({ players: [] });
    setupPlugin(state, ['Первое', 'Второе']);

    await vi.advanceTimersByTimeAsync(1000);
    expect(commands).toEqual([]);

    state.players = [makePlayer()];
    await vi.advanceTimersByTimeAsync(1000);
    expect(commands).toEqual(['AdminBroadcast Первое']);
  });
});
