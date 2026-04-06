import test from 'ava';

import {remoteReducer} from '../../lib/remote-ui/store/remote-store';
import type {RemoteState} from '../../lib/remote-ui/store/remote-store';
import type {TerminalSessionInfo} from '../../lib/remote-ui/types';

function makeState(overrides: Partial<RemoteState> = {}): RemoteState {
  return {
    sessions: [],
    windows: [],
    activeSessionUid: null,
    connectionStatus: 'connecting',
    lastError: null,
    layoutMode: 'tabs',
    historyLoading: {},
    collapsedWindows: {},
    subscribedUids: [],
    ...overrides
  };
}

function makeSession(overrides: Partial<TerminalSessionInfo> = {}): TerminalSessionInfo {
  return {
    uid: 'session-1',
    windowId: 'window-1',
    windowTitle: 'Hyper',
    tabIndex: 0,
    shell: '/bin/zsh',
    pid: 12345,
    cwd: '/home/user',
    profile: 'default',
    createdAt: Date.now(),
    ...overrides
  };
}

// --- SET_LAYOUT_MODE ---

test('SET_LAYOUT_MODE switches to grid', (t) => {
  const state = makeState();
  const result = remoteReducer(state, {type: 'SET_LAYOUT_MODE', payload: 'grid'});
  t.is(result.layoutMode, 'grid');
});

test('SET_LAYOUT_MODE switches back to tabs', (t) => {
  const state = makeState({layoutMode: 'grid'});
  const result = remoteReducer(state, {type: 'SET_LAYOUT_MODE', payload: 'tabs'});
  t.is(result.layoutMode, 'tabs');
});

test('SET_LAYOUT_MODE does not affect other state', (t) => {
  const state = makeState({activeSessionUid: 's1', connectionStatus: 'connected'});
  const result = remoteReducer(state, {type: 'SET_LAYOUT_MODE', payload: 'grid'});
  t.is(result.activeSessionUid, 's1');
  t.is(result.connectionStatus, 'connected');
});

// --- HISTORY_CHUNK_RECEIVED ---

test('HISTORY_CHUNK_RECEIVED records first chunk progress', (t) => {
  const state = makeState();
  const result = remoteReducer(state, {
    type: 'HISTORY_CHUNK_RECEIVED',
    payload: {uid: 's1', chunk: 0, total: 5}
  });
  t.deepEqual(result.historyLoading, {s1: {received: 1, total: 5}});
});

test('HISTORY_CHUNK_RECEIVED updates existing progress', (t) => {
  const state = makeState({historyLoading: {s1: {received: 1, total: 5}}});
  const result = remoteReducer(state, {
    type: 'HISTORY_CHUNK_RECEIVED',
    payload: {uid: 's1', chunk: 1, total: 5}
  });
  t.deepEqual(result.historyLoading, {s1: {received: 2, total: 5}});
});

test('HISTORY_CHUNK_RECEIVED tracks multiple sessions independently', (t) => {
  const state = makeState({historyLoading: {s1: {received: 2, total: 3}}});
  const result = remoteReducer(state, {
    type: 'HISTORY_CHUNK_RECEIVED',
    payload: {uid: 's2', chunk: 0, total: 10}
  });
  t.deepEqual(result.historyLoading, {
    s1: {received: 2, total: 3},
    s2: {received: 1, total: 10}
  });
});

test('HISTORY_CHUNK_RECEIVED single chunk history', (t) => {
  const state = makeState();
  const result = remoteReducer(state, {
    type: 'HISTORY_CHUNK_RECEIVED',
    payload: {uid: 's1', chunk: 0, total: 1}
  });
  t.deepEqual(result.historyLoading, {s1: {received: 1, total: 1}});
});

// --- HISTORY_COMPLETE ---

test('HISTORY_COMPLETE removes loading state for uid', (t) => {
  const state = makeState({historyLoading: {s1: {received: 5, total: 5}, s2: {received: 1, total: 3}}});
  const result = remoteReducer(state, {type: 'HISTORY_COMPLETE', payload: {uid: 's1'}});
  t.deepEqual(result.historyLoading, {s2: {received: 1, total: 3}});
});

test('HISTORY_COMPLETE on non-existent uid is a no-op', (t) => {
  const state = makeState({historyLoading: {s1: {received: 1, total: 1}}});
  const result = remoteReducer(state, {type: 'HISTORY_COMPLETE', payload: {uid: 's-unknown'}});
  t.deepEqual(result.historyLoading, {s1: {received: 1, total: 1}});
});

test('HISTORY_COMPLETE on empty historyLoading', (t) => {
  const state = makeState();
  const result = remoteReducer(state, {type: 'HISTORY_COMPLETE', payload: {uid: 's1'}});
  t.deepEqual(result.historyLoading, {});
});

// --- TOGGLE_WINDOW_COLLAPSED ---

test('TOGGLE_WINDOW_COLLAPSED collapses a window', (t) => {
  const state = makeState();
  const result = remoteReducer(state, {type: 'TOGGLE_WINDOW_COLLAPSED', payload: 'w1'});
  t.is(result.collapsedWindows['w1'], true);
});

test('TOGGLE_WINDOW_COLLAPSED expands a collapsed window', (t) => {
  const state = makeState({collapsedWindows: {w1: true}});
  const result = remoteReducer(state, {type: 'TOGGLE_WINDOW_COLLAPSED', payload: 'w1'});
  t.is(result.collapsedWindows['w1'], false);
});

test('TOGGLE_WINDOW_COLLAPSED does not affect other windows', (t) => {
  const state = makeState({collapsedWindows: {w1: true, w2: false}});
  const result = remoteReducer(state, {type: 'TOGGLE_WINDOW_COLLAPSED', payload: 'w1'});
  t.is(result.collapsedWindows['w1'], false);
  t.is(result.collapsedWindows['w2'], false);
});

// --- REMOVE_SESSION cleans up historyLoading ---

test('REMOVE_SESSION cleans up historyLoading for removed session', (t) => {
  const session = makeSession({uid: 's1', windowId: 'w1'});
  const state = makeState({
    sessions: [session],
    windows: [{uid: 'w1', title: 'Win', sessions: ['s1']}],
    historyLoading: {s1: {received: 2, total: 5}}
  });
  const result = remoteReducer(state, {type: 'REMOVE_SESSION', payload: {uid: 's1'}});
  t.deepEqual(result.historyLoading, {});
});

test('REMOVE_SESSION preserves historyLoading for other sessions', (t) => {
  const s1 = makeSession({uid: 's1', windowId: 'w1'});
  const s2 = makeSession({uid: 's2', windowId: 'w1'});
  const state = makeState({
    sessions: [s1, s2],
    windows: [{uid: 'w1', title: 'Win', sessions: ['s1', 's2']}],
    historyLoading: {s1: {received: 1, total: 1}, s2: {received: 3, total: 5}}
  });
  const result = remoteReducer(state, {type: 'REMOVE_SESSION', payload: {uid: 's1'}});
  t.deepEqual(result.historyLoading, {s2: {received: 3, total: 5}});
});

// --- Initial state includes new fields ---

test('initial state includes layoutMode, historyLoading, collapsedWindows', (t) => {
  const state = makeState();
  t.is(state.layoutMode, 'tabs');
  t.deepEqual(state.historyLoading, {});
  t.deepEqual(state.collapsedWindows, {});
});
