import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS } from '../../constants';
import { serversState } from '../../serversState';
import { createFakeState } from '../../test/fakes';
import { TGetAdmins } from '../../types';
import { initState } from './index';
import { updateAdmins } from './updateAdmins';
import { updateCurrentMap } from './updateCurrentMap';
import { updateNextMap } from './updateNextMap';
import { updatePlayers } from './updatePlayers';
import { updateServerInfo } from './updateServerInfo';
import { updateSquads } from './updateSquads';

vi.mock('./updateAdmins', () => ({ updateAdmins: vi.fn() }));
vi.mock('./updateCurrentMap', () => ({ updateCurrentMap: vi.fn() }));
vi.mock('./updateNextMap', () => ({ updateNextMap: vi.fn() }));
vi.mock('./updatePlayers', () => ({ updatePlayers: vi.fn() }));
vi.mock('./updateServerInfo', () => ({ updateServerInfo: vi.fn() }));
vi.mock('./updateSquads', () => ({ updateSquads: vi.fn() }));

const SERVER_ID = 987654;
const getAdmins = (() => Promise.resolve({})) as TGetAdmins;
const mockedRefreshes = [
  vi.mocked(updateAdmins),
  vi.mocked(updatePlayers),
  vi.mocked(updateSquads),
  vi.mocked(updateCurrentMap),
  vi.mocked(updateNextMap),
  vi.mocked(updateServerInfo),
];

const flushMicrotasks = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};

describe('state NEW_GAME forwarding', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const refresh of mockedRefreshes) {
      refresh.mockReset();
      refresh.mockResolvedValue(undefined as never);
    }
    serversState[SERVER_ID] = createFakeState({ id: SERVER_ID }).state;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete serversState[SERVER_ID];
  });

  it('emits NEW_GAME before waiting for state refreshes', async () => {
    await initState(SERVER_ID, getAdmins);
    for (const refresh of mockedRefreshes) refresh.mockClear();

    let releasePlayers = () => {};
    vi.mocked(updatePlayers).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releasePlayers = resolve;
        }),
    );

    const state = serversState[SERVER_ID];
    const events: string[] = [];
    state.listener.on(EVENTS.NEW_GAME, () => events.push('NEW_GAME'));

    state.coreListener.emit(EVENTS.NEW_GAME, { round: 2 });

    expect(events).toEqual(['NEW_GAME']);
    expect(updatePlayers).toHaveBeenCalledOnce();
    expect(updateSquads).not.toHaveBeenCalled();

    releasePlayers();
    await flushMicrotasks();

    expect(updateSquads).toHaveBeenCalledOnce();
    expect(updateCurrentMap).toHaveBeenCalledOnce();
    expect(updateNextMap).toHaveBeenCalledOnce();
    expect(updateServerInfo).toHaveBeenCalledOnce();
    expect(updateAdmins).toHaveBeenCalledOnce();
    expect(events).toEqual(['NEW_GAME']);
  });

  it('continues refreshing after one NEW_GAME refresh fails', async () => {
    await initState(SERVER_ID, getAdmins);
    for (const refresh of mockedRefreshes) refresh.mockClear();
    vi.mocked(updateCurrentMap).mockRejectedValueOnce(
      new Error('map refresh failed'),
    );

    const state = serversState[SERVER_ID];
    const onNewGame = vi.fn();
    state.listener.on(EVENTS.NEW_GAME, onNewGame);

    state.coreListener.emit(EVENTS.NEW_GAME, { round: 2 });
    await flushMicrotasks();

    expect(onNewGame).toHaveBeenCalledOnce();
    expect(updatePlayers).toHaveBeenCalledOnce();
    expect(updateSquads).toHaveBeenCalledOnce();
    expect(updateNextMap).toHaveBeenCalledOnce();
    expect(updateServerInfo).toHaveBeenCalledOnce();
    expect(updateAdmins).toHaveBeenCalledOnce();
  });
});
