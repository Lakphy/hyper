import {createServer} from 'http';
import * as crypto from 'crypto';
import * as path from 'path';
import express from 'express';
import {WebSocketServer, WebSocket} from 'ws';
import type {IncomingMessage} from 'http';
import {TerminalStateManager} from './state-manager';
import type {TerminalSessionInfo} from './state-manager';
import {encodeSessionData, isBinaryMessage, decodeSessionData} from './binary-protocol';
import {WSDataBatcher} from './ws-data-batcher';
import {SubscriptionManager} from './subscription-manager';
import {AdaptiveThrottler} from './adaptive-throttler';

interface WSMessage {
  type: 'snapshot' | 'session_added' | 'session_removed' | 'session_data' | 'session_history' | 'input' | 'resize' | 'subscribe' | 'unsubscribe' | 'error';
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

  constructor(port: number = 3030, config: RemoteConfig = {}) {
    this.port = port;
    this.config = {
      enabled: true,
      host: '127.0.0.1',
      auth: {type: 'token', token: 'auto'},
      features: {allowInput: true, allowResize: false},
      ...config
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

    // Setup WebSocket server
    this.wss = new WebSocketServer({server: this.httpServer});

    this.setupRoutes();
    this.setupWebSocket();
    this.setupStateListeners();

    // Start server
    this.httpServer.listen(port, this.config.host, () => {
      this.showAccessURL();
    });
  }

  private setupRoutes() {
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

      // Create batcher for this client
      const batcher = new WSDataBatcher((batch: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(batch);
        }
      });
      this.batchers.set(clientId, batcher);

      // Send initial snapshot
      this.sendSnapshot(ws);

      // Handle messages
      ws.on('message', (data: Buffer) => {
        this.handleClientMessage(clientId, ws, data);
      });

      // Handle disconnect
      ws.on('close', () => {
        this.clients.delete(clientId);
        this.subscriptionManager.removeClient(clientId);
        const batcher = this.batchers.get(clientId);
        if (batcher) {
          batcher.destroy();
          this.batchers.delete(clientId);
        }
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

    this.stateManager.on('session_data', ({uid, data}: {uid: string; data: string}) => {
      this.broadcastSessionData(uid, data);
    });
  }

  private sendSnapshot(ws: WebSocket) {
    const snapshot = {
      sessions: this.stateManager.getAllSessions(),
      windows: this.stateManager.getAllWindows()
    };
    ws.send(JSON.stringify({type: 'snapshot', payload: snapshot}));
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
          this.handleSubscribe(clientId, message.payload);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(clientId, message.payload);
          break;
        case 'input':
          this.handleInput(message.payload);
          break;
        case 'resize':
          this.handleResize(message.payload);
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

    // Send history for newly subscribed sessions
    const ws = this.clients.get(clientId);
    if (ws) {
      for (const uid of uids) {
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
      throw new Error('Remote resize is disabled');
    }

    const {uid, cols, rows} = payload;
    if (!uid || typeof cols !== 'number' || typeof rows !== 'number') {
      throw new Error('Invalid resize payload');
    }

    const session = this.stateManager.getSession(uid);
    if (!session) {
      throw new Error('Session not found');
    }

    // Emit event that will be handled by the session in window.ts
    this.stateManager.emit('remote_resize', {uid, cols, rows});
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
    const url = this.authToken
      ? `http://${this.config.host}:${this.port}?token=${this.authToken}`
      : `http://${this.config.host}:${this.port}`;
    console.log(`\n🌐 Remote Terminal Server started at:\n${url}\n`);
  }

  // Public API
  getStateManager(): TerminalStateManager {
    return this.stateManager;
  }

  close() {
    this.stateManager.destroy();
    this.wss.close();
    this.httpServer.close();
    for (const batcher of this.batchers.values()) {
      batcher.destroy();
    }
    this.batchers.clear();
    this.clients.clear();
  }
}
