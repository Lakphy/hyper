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
    clientCount: 1,
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

// --- SET_SUBSCRIBED_UIDS ---

test('SET_SUBSCRIBED_UIDS sets uids', (t) => {
  const state = makeState();
  const result = remoteReducer(state, {type: 'SET_SUBSCRIBED_UIDS', payload: ['s1', 's2']});
  t.deepEqual(result.subscribedUids, ['s1', 's2']);
});

test('SET_SUBSCRIBED_UIDS replaces existing uids', (t) => {
  const state = makeState({subscribedUids: ['s1', 's2']});
  const result = remoteReducer(state, {type: 'SET_SUBSCRIBED_UIDS', payload: ['s3']});
  t.deepEqual(result.subscribedUids, ['s3']);
});

test('SET_SUBSCRIBED_UIDS can clear to empty', (t) => {
  const state = makeState({subscribedUids: ['s1']});
  const result = remoteReducer(state, {type: 'SET_SUBSCRIBED_UIDS', payload: []});
  t.deepEqual(result.subscribedUids, []);
});

test('SET_SUBSCRIBED_UIDS does not affect other state', (t) => {
  const state = makeState({activeSessionUid: 's1', connectionStatus: 'connected'});
  const result = remoteReducer(state, {type: 'SET_SUBSCRIBED_UIDS', payload: ['s2']});
  t.is(result.activeSessionUid, 's1');
  t.is(result.connectionStatus, 'connected');
});

// --- Initial state includes subscribedUids ---

test('initial state includes subscribedUids as empty array', (t) => {
  const state = makeState();
  t.deepEqual(state.subscribedUids, []);
});

// --- UPDATE_SESSION ---

test('UPDATE_SESSION merges changes into matching session', (t) => {
  const state = makeState({sessions: [makeSession({uid: 's1', cols: 80, rows: 24})]});
  const result = remoteReducer(state, {
    type: 'UPDATE_SESSION',
    payload: {uid: 's1', changes: {cols: 120, rows: 40}}
  });
  t.is(result.sessions[0].cols, 120);
  t.is(result.sessions[0].rows, 40);
  // Original fields preserved
  t.is(result.sessions[0].shell, '/bin/zsh');
});

test('UPDATE_SESSION does not affect other sessions', (t) => {
  const state = makeState({
    sessions: [makeSession({uid: 's1', cols: 80}), makeSession({uid: 's2', cols: 100})]
  });
  const result = remoteReducer(state, {
    type: 'UPDATE_SESSION',
    payload: {uid: 's1', changes: {cols: 120}}
  });
  t.is(result.sessions[0].cols, 120);
  t.is(result.sessions[1].cols, 100);
});

test('UPDATE_SESSION on non-existent uid returns state unchanged', (t) => {
  const state = makeState({sessions: [makeSession({uid: 's1'})]});
  const result = remoteReducer(state, {
    type: 'UPDATE_SESSION',
    payload: {uid: 'ghost', changes: {cols: 120}}
  });
  t.deepEqual(result.sessions, state.sessions);
});
