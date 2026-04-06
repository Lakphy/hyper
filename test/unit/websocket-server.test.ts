import test from 'ava';
import {WebSocket} from 'ws';
import http from 'http';

import {RemoteTerminalServer} from '../../app/remote/websocket-server';

// Ensure tests don't hang
test.afterEach(() => {
  // Give servers time to fully close
  return new Promise((resolve) => setTimeout(resolve, 50));
});

function getPort(): number {
  return 30000 + Math.floor(Math.random() * 10000);
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    ws.once('message', (data: Buffer) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

function httpGet(url: string): Promise<{status: number; body: string}> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk.toString()));
      res.on('end', () => resolve({status: res.statusCode!, body}));
    }).on('error', reject);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Server lifecycle ---

test.serial('server starts and stops cleanly', async (t) => {
  const port = getPort();
  const server = new RemoteTerminalServer(port, {host: '127.0.0.1', auth: {type: 'none'}});
  await delay(100);

  const res = await httpGet(`http://127.0.0.1:${port}/health`);
  t.is(res.status, 200);
  const body = JSON.parse(res.body);
  t.is(body.status, 'ok');
  t.is(body.sessions, 0);

  server.close();
});

// --- WebSocket authentication ---

test.serial('ws connection with valid token succeeds', async (t) => {
  const port = getPort();
  const server = new RemoteTerminalServer(port, {host: '127.0.0.1'});
  await delay(100);

  const token = server.getAuthToken();
  const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${token}`);
  await waitForOpen(ws);

  // Should receive snapshot
  const msg = await waitForMessage(ws);
  t.is(msg.type, 'snapshot');
  t.truthy(Array.isArray(msg.payload.sessions));
  t.truthy(Array.isArray(msg.payload.windows));

  ws.close();
  server.close();
});

test.serial('ws connection with invalid token is rejected', async (t) => {
  const port = getPort();
  const server = new RemoteTerminalServer(port, {host: '127.0.0.1'});
  await delay(100);

  const ws = new WebSocket(`ws://127.0.0.1:${port}?token=bad-token`);

  const code = await new Promise<number>((resolve) => {
    ws.on('close', (code: number) => resolve(code));
  });
  t.is(code, 1008); // Policy Violation

  server.close();
});

test.serial('ws connection without token is rejected', async (t) => {
  const port = getPort();
  const server = new RemoteTerminalServer(port, {host: '127.0.0.1'});
  await delay(100);

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);

  const code = await new Promise<number>((resolve) => {
    ws.on('close', (code: number) => resolve(code));
  });
  t.is(code, 1008);

  server.close();
});

// --- HTTP authentication ---

test.serial('HTTP request without token returns 401', async (t) => {
  const port = getPort();
  const server = new RemoteTerminalServer(port, {host: '127.0.0.1'});
  await delay(100);

  const res = await httpGet(`http://127.0.0.1:${port}/`);
  t.is(res.status, 401);

  server.close();
});

test.serial('HTTP request with valid token succeeds', async (t) => {
  const port = getPort();
  const server = new RemoteTerminalServer(port, {host: '127.0.0.1'});
  await delay(100);

  const token = server.getAuthToken();
  const res = await httpGet(`http://127.0.0.1:${port}/?token=${token}`);
  // Auth middleware passed — status is NOT 401 (may be 404 if no index.html in test env)
  t.not(res.status, 401);

  server.close();
});

test.serial('health endpoint does not require auth', async (t) => {
  const port = getPort();
  const server = new RemoteTerminalServer(port, {host: '127.0.0.1'});
  await delay(100);

  const res = await httpGet(`http://127.0.0.1:${port}/health`);
  t.is(res.status, 200);

  server.close();
});

// --- Snapshot and session lifecycle ---

test.serial('snapshot reflects registered sessions', async (t) => {
  const port = getPort();
  const server = new RemoteTerminalServer(port, {host: '127.0.0.1', auth: {type: 'none'}});
  await delay(100);

  // Register a session before connecting
  const sm = server.getStateManager();
  sm.registerSession({
    uid: 'test-session',
    windowId: 'test-window',
    windowTitle: 'Test',
    tabIndex: 0,
    shell: '/bin/zsh',
    pid: 1234,
    cwd: '/tmp',
    profile: 'default',
    createdAt: Date.now()
  });

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await waitForOpen(ws);

  const msg = await waitForMessage(ws);
  t.is(msg.type, 'snapshot');
  t.is(msg.payload.sessions.length, 1);
  t.is(msg.payload.sessions[0].uid, 'test-session');
  t.is(msg.payload.windows.length, 1);

  ws.close();
  server.close();
});

test.serial('session_added is broadcast to connected clients', async (t) => {
  const port = getPort();
  const server = new RemoteTerminalServer(port, {host: '127.0.0.1', auth: {type: 'none'}});
  await delay(100);

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await waitForOpen(ws);

  // Consume snapshot
  await waitForMessage(ws);

  // Register a session after connection
  const sm = server.getStateManager();
  sm.registerSession({
    uid: 'new-session',
    windowId: 'w1',
    windowTitle: 'Win',
    tabIndex: 0,
    shell: '/bin/zsh',
    pid: 5678,
    cwd: '/tmp',
    profile: 'default',
    createdAt: Date.now()
  });

  const msg = await waitForMessage(ws);
  t.is(msg.type, 'session_added');
  t.is(msg.payload.uid, 'new-session');

  ws.close();
  server.close();
});

test.serial('session_removed is broadcast to connected clients', async (t) => {
  const port = getPort();
  const server = new RemoteTerminalServer(port, {host: '127.0.0.1', auth: {type: 'none'}});
  await delay(100);

  const sm = server.getStateManager();
  sm.registerSession({
    uid: 'rm-session',
    windowId: 'w1',
    windowTitle: 'Win',
    tabIndex: 0,
    shell: '/bin/zsh',
    pid: 1111,
    cwd: '/tmp',
    profile: 'default',
    createdAt: Date.now()
  });

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await waitForOpen(ws);
  await waitForMessage(ws); // snapshot

  sm.unregisterSession('rm-session');

  const msg = await waitForMessage(ws);
  t.is(msg.type, 'session_removed');
  t.is(msg.payload.uid, 'rm-session');

  ws.close();
  server.close();
});

// --- Subscribe and session data ---

test.serial('subscribe triggers history and data forwarding', async (t) => {
  const port = getPort();
  const server = new RemoteTerminalServer(port, {host: '127.0.0.1', auth: {type: 'none'}});
  await delay(100);

  const sm = server.getStateManager();
  sm.registerSession({
    uid: 'data-session',
    windowId: 'w1',
    windowTitle: 'Win',
    tabIndex: 0,
    shell: '/bin/zsh',
    pid: 2222,
    cwd: '/tmp',
    profile: 'default',
    createdAt: Date.now()
  });
  sm.onSessionData('data-session', 'hello world');

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await waitForOpen(ws);
  await waitForMessage(ws); // snapshot

  // Subscribe
  ws.send(JSON.stringify({type: 'subscribe', payload: {uids: ['data-session']}}));

  // Should receive history
  const historyMsg = await waitForMessage(ws);
  t.is(historyMsg.type, 'session_history');
  t.is(historyMsg.payload.uid, 'data-session');
  t.is(historyMsg.payload.data, 'hello world');

  ws.close();
  server.close();
});

// --- Input handling ---

test.serial('input message emits remote_input event', async (t) => {
  const port = getPort();
  const server = new RemoteTerminalServer(port, {
    host: '127.0.0.1',
    auth: {type: 'none'},
    features: {allowInput: true}
  });
  await delay(100);

  const sm = server.getStateManager();
  sm.registerSession({
    uid: 'input-session',
    windowId: 'w1',
    windowTitle: 'Win',
    tabIndex: 0,
    shell: '/bin/zsh',
    pid: 3333,
    cwd: '/tmp',
    profile: 'default',
    createdAt: Date.now()
  });

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await waitForOpen(ws);
  await waitForMessage(ws); // snapshot

  const inputReceived = new Promise<{uid: string; data: string}>((resolve) => {
    sm.on('remote_input', resolve);
  });

  ws.send(JSON.stringify({type: 'input', payload: {uid: 'input-session', data: 'ls\n'}}));

  const input = await inputReceived;
  t.is(input.uid, 'input-session');
  t.is(input.data, 'ls\n');

  ws.close();
  server.close();
});

test.serial('input message rejected when allowInput is false', async (t) => {
  const port = getPort();
  const server = new RemoteTerminalServer(port, {
    host: '127.0.0.1',
    auth: {type: 'none'},
    features: {allowInput: false}
  });
  await delay(100);

  const sm = server.getStateManager();
  sm.registerSession({
    uid: 'no-input-session',
    windowId: 'w1',
    windowTitle: 'Win',
    tabIndex: 0,
    shell: '/bin/zsh',
    pid: 4444,
    cwd: '/tmp',
    profile: 'default',
    createdAt: Date.now()
  });

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await waitForOpen(ws);
  await waitForMessage(ws); // snapshot

  ws.send(JSON.stringify({type: 'input', payload: {uid: 'no-input-session', data: 'ls\n'}}));

  const errMsg = await waitForMessage(ws);
  t.is(errMsg.type, 'error');
  t.truthy(errMsg.payload.message.includes('disabled'));

  ws.close();
  server.close();
});

// --- Invalid messages ---

test.serial('invalid message returns error', async (t) => {
  const port = getPort();
  const server = new RemoteTerminalServer(port, {host: '127.0.0.1', auth: {type: 'none'}});
  await delay(100);

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await waitForOpen(ws);
  await waitForMessage(ws); // snapshot

  ws.send(JSON.stringify({type: 'bogus_type', payload: {}}));

  const errMsg = await waitForMessage(ws);
  t.is(errMsg.type, 'error');

  ws.close();
  server.close();
});

// --- session_updated broadcast ---

test.serial('session_updated is broadcast when updateSession is called', async (t) => {
  const port = getPort();
  const server = new RemoteTerminalServer(port, {host: '127.0.0.1', auth: {type: 'none'}});
  await delay(100);

  const sm = server.getStateManager();
  sm.registerSession({
    uid: 'update-session',
    windowId: 'w1',
    windowTitle: 'Win',
    tabIndex: 0,
    shell: '/bin/zsh',
    pid: 7777,
    cwd: '/tmp',
    profile: 'default',
    cols: 80,
    rows: 24,
    createdAt: Date.now()
  });

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await waitForOpen(ws);
  await waitForMessage(ws); // snapshot

  sm.updateSession('update-session', {cols: 120, rows: 40});

  const msg = await waitForMessage(ws);
  t.is(msg.type, 'session_updated');
  t.is(msg.payload.uid, 'update-session');
  t.is(msg.payload.changes.cols, 120);
  t.is(msg.payload.changes.rows, 40);

  ws.close();
  server.close();
});
