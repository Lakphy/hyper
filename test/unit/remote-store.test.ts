import test from 'ava';

import {remoteReducer} from '../../lib/remote-ui/store/remote-store';
import type {RemoteState, RemoteAction} from '../../lib/remote-ui/store/remote-store';
import type {TerminalSessionInfo, WindowInfo} from '../../lib/remote-ui/types';

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

// --- SET_SNAPSHOT ---

test('SET_SNAPSHOT sets sessions and windows', (t) => {
  const sessions = [makeSession({uid: 's1'}), makeSession({uid: 's2'})];
  const windows: WindowInfo[] = [{uid: 'w1', title: 'Win', sessions: ['s1', 's2']}];
  const state = makeState();

  const result = remoteReducer(state, {type: 'SET_SNAPSHOT', payload: {sessions, windows}});

  t.is(result.sessions.length, 2);
  t.is(result.windows.length, 1);
});

test('SET_SNAPSHOT auto-selects first session when none active', (t) => {
  const sessions = [makeSession({uid: 's1'}), makeSession({uid: 's2'})];
  const windows: WindowInfo[] = [{uid: 'w1', title: 'Win', sessions: ['s1', 's2']}];
  const state = makeState();

  const result = remoteReducer(state, {type: 'SET_SNAPSHOT', payload: {sessions, windows}});

  t.is(result.activeSessionUid, 's1');
});

test('SET_SNAPSHOT preserves active session if still present', (t) => {
  const sessions = [makeSession({uid: 's1'}), makeSession({uid: 's2'})];
  const windows: WindowInfo[] = [{uid: 'w1', title: 'Win', sessions: ['s1', 's2']}];
  const state = makeState({activeSessionUid: 's2'});

  const result = remoteReducer(state, {type: 'SET_SNAPSHOT', payload: {sessions, windows}});

  t.is(result.activeSessionUid, 's2');
});

test('SET_SNAPSHOT resets active session if it was removed', (t) => {
  const sessions = [makeSession({uid: 's1'})];
  const windows: WindowInfo[] = [{uid: 'w1', title: 'Win', sessions: ['s1']}];
  const state = makeState({activeSessionUid: 's-gone'});

  const result = remoteReducer(state, {type: 'SET_SNAPSHOT', payload: {sessions, windows}});

  t.is(result.activeSessionUid, 's1');
});

test('SET_SNAPSHOT with empty sessions sets null active', (t) => {
  const state = makeState({activeSessionUid: 's1'});

  const result = remoteReducer(state, {type: 'SET_SNAPSHOT', payload: {sessions: [], windows: []}});

  t.is(result.activeSessionUid, null);
});

// --- ADD_SESSION ---

test('ADD_SESSION adds session to list', (t) => {
  const state = makeState();
  const session = makeSession({uid: 's1', windowId: 'w1'});

  const result = remoteReducer(state, {type: 'ADD_SESSION', payload: session});

  t.is(result.sessions.length, 1);
  t.is(result.sessions[0].uid, 's1');
});

test('ADD_SESSION creates window if not exists', (t) => {
  const state = makeState();
  const session = makeSession({uid: 's1', windowId: 'w1', windowTitle: 'New Window'});

  const result = remoteReducer(state, {type: 'ADD_SESSION', payload: session});

  t.is(result.windows.length, 1);
  t.is(result.windows[0].uid, 'w1');
  t.deepEqual(result.windows[0].sessions, ['s1']);
});

test('ADD_SESSION adds to existing window', (t) => {
  const state = makeState({
    sessions: [makeSession({uid: 's1', windowId: 'w1'})],
    windows: [{uid: 'w1', title: 'Win', sessions: ['s1']}]
  });
  const session = makeSession({uid: 's2', windowId: 'w1'});

  const result = remoteReducer(state, {type: 'ADD_SESSION', payload: session});

  t.is(result.windows.length, 1);
  t.deepEqual(result.windows[0].sessions, ['s1', 's2']);
});

test('ADD_SESSION auto-selects if first session', (t) => {
  const state = makeState();
  const session = makeSession({uid: 's1'});

  const result = remoteReducer(state, {type: 'ADD_SESSION', payload: session});

  t.is(result.activeSessionUid, 's1');
});

test('ADD_SESSION does not change active if already set', (t) => {
  const state = makeState({
    sessions: [makeSession({uid: 's1'})],
    activeSessionUid: 's1'
  });
  const session = makeSession({uid: 's2'});

  const result = remoteReducer(state, {type: 'ADD_SESSION', payload: session});

  t.is(result.activeSessionUid, 's1');
});

// --- REMOVE_SESSION ---

test('REMOVE_SESSION removes session from list', (t) => {
  const state = makeState({
    sessions: [makeSession({uid: 's1'}), makeSession({uid: 's2'})],
    windows: [{uid: 'w1', title: 'Win', sessions: ['s1', 's2']}]
  });

  const result = remoteReducer(state, {type: 'REMOVE_SESSION', payload: {uid: 's1'}});

  t.is(result.sessions.length, 1);
  t.is(result.sessions[0].uid, 's2');
});

test('REMOVE_SESSION removes session from window', (t) => {
  const state = makeState({
    sessions: [makeSession({uid: 's1'}), makeSession({uid: 's2'})],
    windows: [{uid: 'w1', title: 'Win', sessions: ['s1', 's2']}]
  });

  const result = remoteReducer(state, {type: 'REMOVE_SESSION', payload: {uid: 's1'}});

  t.deepEqual(result.windows[0].sessions, ['s2']);
});

test('REMOVE_SESSION removes empty window', (t) => {
  const state = makeState({
    sessions: [makeSession({uid: 's1'})],
    windows: [{uid: 'w1', title: 'Win', sessions: ['s1']}]
  });

  const result = remoteReducer(state, {type: 'REMOVE_SESSION', payload: {uid: 's1'}});

  t.is(result.windows.length, 0);
});

test('REMOVE_SESSION switches active to next session', (t) => {
  const state = makeState({
    sessions: [makeSession({uid: 's1'}), makeSession({uid: 's2'})],
    windows: [{uid: 'w1', title: 'Win', sessions: ['s1', 's2']}],
    activeSessionUid: 's1'
  });

  const result = remoteReducer(state, {type: 'REMOVE_SESSION', payload: {uid: 's1'}});

  t.is(result.activeSessionUid, 's2');
});

test('REMOVE_SESSION sets null active when last session removed', (t) => {
  const state = makeState({
    sessions: [makeSession({uid: 's1'})],
    windows: [{uid: 'w1', title: 'Win', sessions: ['s1']}],
    activeSessionUid: 's1'
  });

  const result = remoteReducer(state, {type: 'REMOVE_SESSION', payload: {uid: 's1'}});

  t.is(result.activeSessionUid, null);
});

test('REMOVE_SESSION keeps active if different session removed', (t) => {
  const state = makeState({
    sessions: [makeSession({uid: 's1'}), makeSession({uid: 's2'})],
    windows: [{uid: 'w1', title: 'Win', sessions: ['s1', 's2']}],
    activeSessionUid: 's2'
  });

  const result = remoteReducer(state, {type: 'REMOVE_SESSION', payload: {uid: 's1'}});

  t.is(result.activeSessionUid, 's2');
});

// --- SET_ACTIVE_SESSION ---

test('SET_ACTIVE_SESSION changes active session', (t) => {
  const state = makeState({activeSessionUid: 's1'});

  const result = remoteReducer(state, {type: 'SET_ACTIVE_SESSION', payload: 's2'});

  t.is(result.activeSessionUid, 's2');
});

test('SET_ACTIVE_SESSION can set to null', (t) => {
  const state = makeState({activeSessionUid: 's1'});

  const result = remoteReducer(state, {type: 'SET_ACTIVE_SESSION', payload: null});

  t.is(result.activeSessionUid, null);
});

// --- SET_CONNECTION_STATUS ---

test('SET_CONNECTION_STATUS updates status', (t) => {
  const state = makeState();

  const result = remoteReducer(state, {type: 'SET_CONNECTION_STATUS', payload: 'connected'});

  t.is(result.connectionStatus, 'connected');
});

// --- SET_ERROR ---

test('SET_ERROR sets error message', (t) => {
  const state = makeState();

  const result = remoteReducer(state, {type: 'SET_ERROR', payload: 'Connection failed'});

  t.is(result.lastError, 'Connection failed');
});

test('SET_ERROR can clear error', (t) => {
  const state = makeState({lastError: 'old error'});

  const result = remoteReducer(state, {type: 'SET_ERROR', payload: null});

  t.is(result.lastError, null);
});

// --- Unknown action ---

test('unknown action returns state unchanged', (t) => {
  const state = makeState({activeSessionUid: 's1'});

  const result = remoteReducer(state, {type: 'UNKNOWN' as any, payload: null} as any);

  t.deepEqual(result, state);
});
