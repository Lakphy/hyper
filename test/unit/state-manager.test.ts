import test from 'ava';

import {TerminalStateManager} from '../../app/remote/state-manager';
import type {TerminalSessionInfo} from '../../app/remote/state-manager';

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

test.afterEach((t) => {
  // Ensure state managers are cleaned up to avoid timer leaks
  const mgr = (t.context as any).mgr as TerminalStateManager | undefined;
  mgr?.destroy();
});

function createManager(t: any): TerminalStateManager {
  const mgr = new TerminalStateManager();
  t.context.mgr = mgr;
  return mgr;
}

test('registerSession adds session and window', (t) => {
  const mgr = createManager(t);
  const session = makeSession();
  mgr.registerSession(session);

  t.deepEqual(mgr.getAllSessions(), [session]);
  t.is(mgr.getAllWindows().length, 1);
  t.is(mgr.getAllWindows()[0].uid, 'window-1');
  t.deepEqual(mgr.getAllWindows()[0].sessions, ['session-1']);
});

test('registerSession groups sessions under same window', (t) => {
  const mgr = createManager(t);
  mgr.registerSession(makeSession({uid: 's1', windowId: 'w1'}));
  mgr.registerSession(makeSession({uid: 's2', windowId: 'w1'}));

  t.is(mgr.getAllWindows().length, 1);
  t.deepEqual(mgr.getAllWindows()[0].sessions, ['s1', 's2']);
});

test('registerSession creates separate windows', (t) => {
  const mgr = createManager(t);
  mgr.registerSession(makeSession({uid: 's1', windowId: 'w1'}));
  mgr.registerSession(makeSession({uid: 's2', windowId: 'w2'}));

  t.is(mgr.getAllWindows().length, 2);
});

test('registerSession emits session_added event', (t) => {
  const mgr = createManager(t);
  const session = makeSession();
  let emitted: TerminalSessionInfo | null = null;
  mgr.on('session_added', (info) => {
    emitted = info;
  });

  mgr.registerSession(session);
  t.deepEqual(emitted, session);
});

test('registerSession does not duplicate session in window', (t) => {
  const mgr = createManager(t);
  const session = makeSession();
  mgr.registerSession(session);
  mgr.registerSession(session); // register same session again

  t.is(mgr.getAllWindows()[0].sessions.length, 1);
});

test('unregisterSession removes session', (t) => {
  const mgr = createManager(t);
  mgr.registerSession(makeSession({uid: 's1'}));
  mgr.unregisterSession('s1');

  t.is(mgr.getAllSessions().length, 0);
  t.is(mgr.getSession('s1'), undefined);
});

test('unregisterSession removes empty window', (t) => {
  const mgr = createManager(t);
  mgr.registerSession(makeSession({uid: 's1', windowId: 'w1'}));
  mgr.unregisterSession('s1');

  t.is(mgr.getAllWindows().length, 0);
});

test('unregisterSession keeps window with remaining sessions', (t) => {
  const mgr = createManager(t);
  mgr.registerSession(makeSession({uid: 's1', windowId: 'w1'}));
  mgr.registerSession(makeSession({uid: 's2', windowId: 'w1'}));
  mgr.unregisterSession('s1');

  t.is(mgr.getAllWindows().length, 1);
  t.deepEqual(mgr.getAllWindows()[0].sessions, ['s2']);
});

test('unregisterSession emits session_removed event', (t) => {
  const mgr = createManager(t);
  mgr.registerSession(makeSession({uid: 's1'}));

  let emitted: {uid: string} | null = null;
  mgr.on('session_removed', (data) => {
    emitted = data;
  });

  mgr.unregisterSession('s1');
  t.deepEqual(emitted, {uid: 's1'});
});

test('unregisterSession on non-existent session is a no-op', (t) => {
  const mgr = createManager(t);
  mgr.unregisterSession('ghost');
  t.is(mgr.getAllSessions().length, 0);
});

test('onSessionData stores data in buffer', (t) => {
  const mgr = createManager(t);
  mgr.registerSession(makeSession({uid: 's1'}));
  mgr.onSessionData('s1', 'hello');
  mgr.onSessionData('s1', ' world');

  t.is(mgr.getSessionHistory('s1'), 'hello world');
});

test('onSessionData emits session_data event', (t) => {
  const mgr = createManager(t);
  mgr.registerSession(makeSession({uid: 's1'}));

  let emitted: {uid: string; data: string} | null = null;
  mgr.on('session_data', (payload) => {
    emitted = payload;
  });

  mgr.onSessionData('s1', 'test');
  t.deepEqual(emitted, {uid: 's1', data: 'test'});
});

test('onSessionData creates buffer for unregistered session', (t) => {
  const mgr = createManager(t);
  // No registerSession call
  mgr.onSessionData('s1', 'data');
  t.is(mgr.getSessionHistory('s1'), 'data');
});

test('getSessionHistory returns null for unknown session', (t) => {
  const mgr = createManager(t);
  t.is(mgr.getSessionHistory('ghost'), null);
});

test('getSession returns session info', (t) => {
  const mgr = createManager(t);
  const session = makeSession({uid: 's1'});
  mgr.registerSession(session);
  t.deepEqual(mgr.getSession('s1'), session);
});

test('getSession returns undefined for unknown session', (t) => {
  const mgr = createManager(t);
  t.is(mgr.getSession('ghost'), undefined);
});

test('destroy clears all state', (t) => {
  const mgr = new TerminalStateManager();
  mgr.registerSession(makeSession({uid: 's1'}));
  mgr.onSessionData('s1', 'data');
  mgr.destroy();

  t.is(mgr.getAllSessions().length, 0);
  t.is(mgr.getAllWindows().length, 0);
  t.is(mgr.getSessionHistory('s1'), null);
  // No need to call destroy again in afterEach
  (t.context as any).mgr = undefined;
});

test('destroy removes all event listeners', (t) => {
  const mgr = new TerminalStateManager();
  mgr.on('session_added', () => {});
  mgr.on('session_data', () => {});
  mgr.destroy();

  t.is(mgr.listenerCount('session_added'), 0);
  t.is(mgr.listenerCount('session_data'), 0);
  (t.context as any).mgr = undefined;
});

// --- updateSession ---

test('updateSession merges changes into existing session', (t) => {
  const mgr = createManager(t);
  mgr.registerSession(makeSession({uid: 's1'}));
  mgr.updateSession('s1', {cols: 120, rows: 40});

  const session = mgr.getSession('s1');
  t.is(session?.cols, 120);
  t.is(session?.rows, 40);
  // Original fields preserved
  t.is(session?.shell, '/bin/zsh');
});

test('updateSession emits session_updated event', (t) => {
  const mgr = createManager(t);
  mgr.registerSession(makeSession({uid: 's1'}));

  let emitted: any = null;
  mgr.on('session_updated', (data) => {
    emitted = data;
  });

  mgr.updateSession('s1', {cols: 80, rows: 24});
  t.truthy(emitted);
  t.is(emitted.uid, 's1');
  t.deepEqual(emitted.changes, {cols: 80, rows: 24});
});

test('updateSession on non-existent uid is a no-op', (t) => {
  const mgr = createManager(t);
  let emitted = false;
  mgr.on('session_updated', () => {
    emitted = true;
  });

  mgr.updateSession('ghost', {cols: 80});
  t.false(emitted);
});
