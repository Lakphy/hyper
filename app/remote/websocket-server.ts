import * as crypto from 'crypto';
import {createServer} from 'http';
import type {IncomingMessage} from 'http';
import * as path from 'path';

/* eslint-disable import/no-extraneous-dependencies -- express/ws are runtime deps; TS resolver attributes @types */
import express from 'express';
import {WebSocketServer, WebSocket} from 'ws';
/* eslint-enable import/no-extraneous-dependencies */

import {AdaptiveThrottler} from './adaptive-throttler';
import {encodeSessionData} from './binary-protocol';
import {TerminalStateManager} from './state-manager';
import type {TerminalSessionInfo} from './state-manager';
import {SubscriptionManager} from './subscription-manager';
import {WSDataBatcher} from './ws-data-batcher';

interface WSMessage {
  type:
    | 'snapshot'
    | 'session_added'
    | 'session_removed'
    | 'session_updated'
    | 'session_data'
    | 'session_history'
    | 'input'
    | 'resize'
    | 'subscribe'
    | 'unsubscribe'
    | 'create_tab'
    | 'close_tab'
    | 'create_window'
    | 'client_count'
    | 'error';
  payload: any;
}

interface RemoteConfig {
  enabled?: boolean;
  port?: number;
  host?: string;
  auth?: {
    type?: 'token' | 'none';
    token?: string;
  };
  features?: {
    allowInput?: boolean;
    allowResize?: boolean;
  };
}

export class RemoteTerminalServer {
  private httpServer: ReturnType<typeof createServer>;
  private wss: WebSocketServer;
  private app: express.Application;
  private stateManager: TerminalStateManager;
  private clients = new Map<string, WebSocket>();
  private batchers = new Map<string, WSDataBatcher>();
  private subscriptionManager: SubscriptionManager;
  private throttler: AdaptiveThrottler;
  private authToken: string;
  private config: RemoteConfig;
  private port: number;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private clientAlive = new Map<string, boolean>();
  private resizeTimers = new Map<string, NodeJS.Timeout>();
  private pendingResizes = new Map<string, {cols: number; rows: number}>();

  constructor(port: number = 3030, config: RemoteConfig = {}) {
    this.port = port;
    this.config = {
      enabled: true,
      host: '0.0.0.0',
      auth: {type: 'token', token: 'auto'},
      ...config,
      features: {allowInput: true, allowResize: true, ...config.features}
    };

    // Generate auth token
    this.authToken =
      this.config.auth?.token === 'auto' ? crypto.randomBytes(32).toString('hex') : this.config.auth?.token || '';

    // Initialize managers
    this.stateManager = new TerminalStateManager();
    this.subscriptionManager = new SubscriptionManager();
    this.throttler = new AdaptiveThrottler();

    // Setup HTTP server
    this.app = express();
    this.httpServer = createServer(this.app);

    // Setup WebSocket server with compression
    this.wss = new WebSocketServer({
      server: this.httpServer,
      perMessageDeflate: {
        zlibDeflateOptions: {level: 1}, // fast compression, low CPU
        threshold: 1024 // only compress messages > 1KB
      }
    });

    this.setupRoutes();
    this.setupWebSocket();
    this.setupStateListeners();
    this.startHeartbeat();

    // Start server
    this.httpServer.listen(port, this.config.host, () => {
      this.showAccessURL();
    });
  }

  private parseCookies(header: string | undefined): Record<string, string> {
    if (!header) return {};
    const cookies: Record<string, string> = {};
    for (const pair of header.split(';')) {
      const [name, ...rest] = pair.trim().split('=');
      if (name && rest.length > 0) {
        cookies[name.trim()] = rest.join('=').trim();
      }
    }
    return cookies;
  }

  private setupRoutes() {
    // Auth middleware for HTTP requests
    this.app.use((req, res, next) => {
      if (!this.authToken) return next();
      if (req.path === '/health') return next();
      // Static assets (JS/CSS bundles) don't contain sensitive data;
      // skip auth so that crossorigin script/link tags work without cookies.
      if (req.path.startsWith('/assets/')) return next();

      const token = (req.query.token as string) || this.parseCookies(req.headers.cookie)?.token;
      if (token === this.authToken) {
        // Set cookie so subsequent page navigations don't need ?token
        if (!this.parseCookies(req.headers.cookie)?.token) {
          res.cookie('token', token, {httpOnly: true, sameSite: 'strict', maxAge: 86400000});
        }
        return next();
      }
      res.status(401).json({error: 'Unauthorized'});
    });

    // Serve Web UI static files
    const remoteUiPath = path.resolve(__dirname, '..', 'remote-ui');
    this.app.use(express.static(remoteUiPath));

    // Health check
    this.app.get('/health', (_req, res) => {
      res.json({status: 'ok', sessions: this.stateManager.getAllSessions().length});
    });

    // SPA fallback — serve index.html for any non-API, non-asset route
    this.app.get('*', (_req, res) => {
      res.sendFile(path.join(remoteUiPath, 'index.html'));
    });
  }

  private setupWebSocket() {
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      // Authenticate
      if (this.authToken) {
        const url = new URL(req.url!, `ws://${this.config.host}`);
        const token = url.searchParams.get('token');
        if (token !== this.authToken) {
          ws.close(1008, 'Unauthorized');
          return;
        }
      }

      const clientId = crypto.randomUUID();
      this.clients.set(clientId, ws);
      this.clientAlive.set(clientId, true);

      // Create batcher for this client
      const batcher = new WSDataBatcher((batch: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(batch);
        }
      });
      this.batchers.set(clientId, batcher);

      // Send initial snapshot
      this.sendSnapshot(ws);

      // Notify all clients about the new connection count
      this.broadcastClientCount();

      // Handle heartbeat pong
      ws.on('pong', () => {
        this.clientAlive.set(clientId, true);
      });

      // Handle messages
      ws.on('message', (data: Buffer) => {
        this.handleClientMessage(clientId, ws, data);
      });

      // Handle disconnect
      ws.on('close', () => {
        this.clients.delete(clientId);
        this.clientAlive.delete(clientId);
        this.subscriptionManager.removeClient(clientId);
        const clientBatcher = this.batchers.get(clientId);
        if (clientBatcher) {
          clientBatcher.destroy();
          this.batchers.delete(clientId);
        }
        this.broadcastClientCount();
      });

      ws.on('error', (err) => {
        console.error('WebSocket error:', err);
      });
    });
  }

  private setupStateListeners() {
    // Forward state changes to subscribed clients
    this.stateManager.on('session_added', (info: TerminalSessionInfo) => {
      this.broadcast({type: 'session_added', payload: info});
    });

    this.stateManager.on('session_removed', (data: {uid: string}) => {
      this.broadcast({type: 'session_removed', payload: data});
    });

    this.stateManager.on('session_updated', (data: {uid: string; changes: Partial<TerminalSessionInfo>}) => {
      this.broadcast({type: 'session_updated', payload: data});
    });

    this.stateManager.on('session_data', ({uid, data}: {uid: string; data: string}) => {
      this.broadcastSessionData(uid, data);
    });
  }

  private sendSnapshot(ws: WebSocket) {
    const snapshot = {
      sessions: this.stateManager.getAllSessions(),
      windows: this.stateManager.getAllWindows(),
      clientCount: this.clients.size
    };
    ws.send(JSON.stringify({type: 'snapshot', payload: snapshot}));
  }

  private broadcastClientCount() {
    this.broadcast({type: 'client_count', payload: {count: this.clients.size}});
  }

  private handleClientMessage(clientId: string, ws: WebSocket, data: Buffer) {
    try {
      const message: WSMessage = JSON.parse(data.toString());

      // Validate message format
      if (!message.type || message.payload === undefined) {
        throw new Error('Invalid message format');
      }

      switch (message.type) {
        case 'subscribe':
          this.handleSubscribe(clientId, message.payload as {uids: string[]});
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(clientId, message.payload as {uids: string[]});
          break;
        case 'input':
          this.handleInput(message.payload as {uid: string; data: string});
          break;
        case 'resize':
          this.handleResize(message.payload as {uid: string; cols: number; rows: number});
          break;
        case 'create_tab':
          this.handleCreateTab(message.payload as {windowId?: string});
          break;
        case 'close_tab':
          this.handleCloseTab(message.payload as {uid: string});
          break;
        case 'create_window':
          this.handleCreateWindow();
          break;
        default:
          throw new Error(`Unknown message type: ${message.type}`);
      }
    } catch (err) {
      console.error('Invalid client message:', err);
      ws.send(JSON.stringify({type: 'error', payload: {message: (err as Error).message}}));
    }
  }

  private handleSubscribe(clientId: string, payload: {uids: string[]}) {
    const {uids} = payload;
    this.subscriptionManager.subscribe(clientId, uids);

    // Send history and current size for newly subscribed sessions
    const ws = this.clients.get(clientId);
    if (ws) {
      for (const uid of uids) {
        // Inform the client of the current terminal size so it can adapt
        const session = this.stateManager.getSession(uid);
        if (session && session.cols && session.rows) {
          ws.send(
            JSON.stringify({
              type: 'session_updated',
              payload: {uid, changes: {cols: session.cols, rows: session.rows}}
            })
          );
        }
        void this.sendSessionHistory(ws, uid);
      }
    }
  }

  private handleUnsubscribe(clientId: string, payload: {uids: string[]}) {
    const {uids} = payload;
    this.subscriptionManager.unsubscribe(clientId, uids);
  }

  private handleInput(payload: {uid: string; data: string}) {
    if (!this.config.features?.allowInput) {
      throw new Error('Remote input is disabled');
    }

    const {uid, data} = payload;
    if (!uid || typeof data !== 'string') {
      throw new Error('Invalid input payload');
    }

    if (data.length > 10000) {
      throw new Error('Input too long');
    }

    const session = this.stateManager.getSession(uid);
    if (!session) {
      throw new Error('Session not found');
    }

    // Emit event that will be handled by the session in window.ts
    this.stateManager.emit('remote_input', {uid, data});
  }

  private handleResize(payload: {uid: string; cols: number; rows: number}) {
    if (!this.config.features?.allowResize) {
      return;
    }

    const {uid, cols, rows} = payload;
    if (!uid || typeof cols !== 'number' || typeof rows !== 'number') {
      throw new Error('Invalid resize payload');
    }

    const session = this.stateManager.getSession(uid);
    if (!session) {
      throw new Error('Session not found');
    }

    // Skip if the size hasn't actually changed
    if (session.cols === cols && session.rows === rows) {
      return;
    }

    // Debounce resize per session to prevent thrashing from multiple clients
    this.pendingResizes.set(uid, {cols, rows});
    const existing = this.resizeTimers.get(uid);
    if (existing) clearTimeout(existing);
    this.resizeTimers.set(
      uid,
      setTimeout(() => {
        const size = this.pendingResizes.get(uid);
        if (size) {
          this.stateManager.emit('remote_resize', {uid, ...size});
          this.pendingResizes.delete(uid);
        }
        this.resizeTimers.delete(uid);
      }, 300)
    );
  }

  private handleCreateTab(payload: {windowId?: string}) {
    const {windowId} = payload;

    // If a windowId is provided, verify it exists
    if (windowId) {
      const windows = this.stateManager.getAllWindows();
      const targetWindow = windows.find((w) => w.uid === windowId);
      if (!targetWindow) {
        throw new Error('Window not found');
      }
    }

    // Emit event that will be handled in window.ts to create a new tab
    this.stateManager.emit('remote_create_tab', {windowId: windowId || null});
  }

  private handleCloseTab(payload: {uid: string}) {
    const {uid} = payload;
    if (!uid) {
      throw new Error('Invalid close_tab payload');
    }
    const session = this.stateManager.getSession(uid);
    if (!session) {
      throw new Error('Session not found');
    }
    this.stateManager.emit('remote_close_tab', {uid});
  }

  private handleCreateWindow() {
    this.stateManager.emit('remote_create_window', {});
  }

  private async sendSessionHistory(ws: WebSocket, uid: string) {
    const history = this.stateManager.getSessionHistory(uid);
    if (!history) return;

    const CHUNK_SIZE = 64 * 1024; // 64KB per chunk

    if (history.length <= CHUNK_SIZE) {
      // Small data: send directly
      ws.send(
        JSON.stringify({
          type: 'session_history',
          payload: {uid, data: history, chunk: 0, total: 1}
        })
      );
      return;
    }

    // Large data: send in chunks
    const totalChunks = Math.ceil(history.length / CHUNK_SIZE);
    for (let i = 0; i < totalChunks; i++) {
      // Check if connection is still alive
      if (ws.readyState !== WebSocket.OPEN) return;

      const start = i * CHUNK_SIZE;
      const chunk = history.slice(start, start + CHUNK_SIZE);
      ws.send(
        JSON.stringify({
          type: 'session_history',
          payload: {uid, data: chunk, chunk: i, total: totalChunks}
        })
      );

      // Yield event loop to avoid blocking other connections
      if (i < totalChunks - 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
  }

  private broadcastSessionData(uid: string, data: string) {
    const action = this.throttler.shouldSend(uid, data.length);

    let payload: Buffer;
    switch (action) {
      case 'send':
        payload = encodeSessionData(uid, data);
        break;
      case 'throttle':
        payload = encodeSessionData(uid, this.throttler.summarize(data));
        break;
      case 'drop':
        return; // Discard completely
    }

    const subscribers = this.subscriptionManager.getSubscribers(uid);
    for (const clientId of subscribers) {
      const batcher = this.batchers.get(clientId);
      if (batcher) {
        batcher.write(payload);
      }
    }
  }

  private broadcast(message: WSMessage) {
    const payload = JSON.stringify(message);
    for (const ws of this.clients.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  private showAccessURL() {
    const qs = this.authToken ? `?token=${this.authToken}` : '';
    console.log(`\n🌐 Remote Terminal Server started on port ${this.port}`);
    console.log(`  Local:  http://localhost:${this.port}${qs}`);
    console.log(`  Host:   http://${this.config.host}:${this.port}${qs}\n`);
  }

  // Public API
  getStateManager(): TerminalStateManager {
    return this.stateManager;
  }

  getAuthToken(): string {
    return this.authToken;
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      for (const [clientId, ws] of this.clients) {
        if (!this.clientAlive.get(clientId)) {
          ws.terminate();
          continue;
        }
        this.clientAlive.set(clientId, false);
        ws.ping();
      }
    }, 30000);
  }

  close() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.clientAlive.clear();
    this.stateManager.destroy();
    this.wss.close();
    this.httpServer.close();
    for (const batcher of this.batchers.values()) {
      batcher.destroy();
    }
    this.batchers.clear();
    this.clients.clear();
    for (const timer of this.resizeTimers.values()) {
      clearTimeout(timer);
    }
    this.resizeTimers.clear();
    this.pendingResizes.clear();
  }
}
