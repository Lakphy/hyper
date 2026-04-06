# Hyper 远程终端查看系统 - 架构设计方案

## 一、系统概述

在 Hyper 启动时自动启动本地 WebSocket 服务器，通过浏览器访问查看所有打开的终端（跨窗口、跨 Tab），支持实时查看输出和远程输入。Web UI 与 Electron App 使用完全相同的技术栈和组件，确保体验一致。

## 二、核心架构

### 2.1 架构分层

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron App (多窗口)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Window 1    │  │  Window 2    │  │  Window N    │      │
│  │  - Tab 1     │  │  - Tab 1     │  │  - Tab 1     │      │
│  │  - Tab 2     │  │  - Tab 2     │  │  - Tab 2     │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                  │                  │              │
│         └──────────────────┼──────────────────┘              │
│                            │                                 │
│  ┌─────────────────────────▼──────────────────────────────┐ │
│  │         Central Terminal State Manager                 │ │
│  │  - 全局 Session Registry (Map<uid, SessionInfo>)       │ │
│  │  - 窗口/Tab 层级关系追踪                               │ │
│  │  - 实时数据流分发                                      │ │
│  └─────────────────────────┬──────────────────────────────┘ │
└────────────────────────────┼────────────────────────────────┘
                             │
                ┌────────────▼────────────┐
                │  WebSocket Server       │
                │  (ws://localhost:3030)  │
                │  - 状态同步             │
                │  - 数据流广播           │
                │  - 输入命令转发         │
                └────────────┬────────────┘
                             │
                ┌────────────▼────────────┐
                │   Web UI (浏览器)       │
                │   - React + xterm.js    │
                │   - 与 App 相同组件     │
                │   - 只读/交互模式       │
                └─────────────────────────┘
```

### 2.2 技术栈选择

| 层级 | 技术 | 理由 |
|------|------|------|
| WebSocket 服务器 | `ws` (npm) | 轻量、高性能、与 Electron 兼容 |
| Web 服务器 | `express` | 提供静态文件和 HTML 页面 |
| Web UI 构建 | Vite (已有) | 复用现有构建配置 |
| UI 组件 | React + xterm.js (已有) | 完全复用 App 组件 |
| 状态管理 | EventEmitter + Map | 轻量、符合现有架构 |
| 数据序列化 | JSON + Binary (Buffer) | 兼顾结构化和性能 |

## 三、详细设计

### 3.1 中央状态管理器 (Central State Manager)

**文件**: `app/remote/state-manager.ts`

```typescript
interface TerminalSessionInfo {
  uid: string;
  windowId: string;
  windowTitle: string;
  tabIndex: number;
  shell: string;
  pid: number;
  cwd: string;
  profile: string;
  cols: number;
  rows: number;
  isActive: boolean;
  createdAt: number;
  lastActivityAt: number;
}

interface WindowInfo {
  id: string;
  title: string;
  bounds: { x: number; y: number; width: number; height: number };
  isMaximized: boolean;
  isFocused: boolean;
  tabs: string[]; // session UIDs
  activeTabUid: string | null;
}

class TerminalStateManager extends EventEmitter {
  private sessions: Map<string, TerminalSessionInfo>;
  private windows: Map<string, WindowInfo>;
  private dataBuffers: Map<string, CircularBuffer>; // 保留最近 N 行输出

  // 注册新会话
  registerSession(info: TerminalSessionInfo): void;

  // 注销会话
  unregisterSession(uid: string): void;

  // 更新会话数据
  updateSession(uid: string, data: Partial<TerminalSessionInfo>): void;

  // 接收终端输出数据
  onSessionData(uid: string, data: string): void;

  // 发送输入到终端
  sendInput(uid: string, data: string): void;

  // 获取完整状态快照
  getSnapshot(): { sessions: TerminalSessionInfo[]; windows: WindowInfo[] };

  // 获取会话历史输出
  getSessionHistory(uid: string, lines?: number): string;
}
```

**关键特性**:
- **循环缓冲区**: 每个 session 保留最近 10000 行输出（可配置）
- **事件驱动**: 状态变更触发事件，WebSocket 服务器订阅
- **单例模式**: 全局唯一实例，所有窗口共享

### 3.2 WebSocket 服务器

**文件**: `app/remote/websocket-server.ts`

```typescript
interface WSMessage {
  type: 'snapshot' | 'session_add' | 'session_remove' | 'session_data'
       | 'session_update' | 'window_update' | 'input' | 'resize';
  payload: any;
}

class RemoteTerminalServer {
  private wss: WebSocketServer;
  private httpServer: express.Application;
  private stateManager: TerminalStateManager;
  private clients: Set<WebSocket>;

  constructor(port: number = 3030) {
    this.httpServer = express();
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupRoutes() {
    // 提供 Web UI 静态文件
    this.httpServer.use(express.static('target/remote-ui'));
    this.httpServer.get('/', (req, res) => {
      res.sendFile('target/remote-ui/index.html');
    });
  }

  private setupWebSocket() {
    this.wss.on('connection', (ws) => {
      // 新客户端连接，发送完整快照
      this.sendSnapshot(ws);

      // 订阅状态变更
      this.subscribeToStateChanges(ws);

      // 处理客户端消息
      ws.on('message', (data) => this.handleClientMessage(ws, data));
    });
  }

  private broadcast(message: WSMessage) {
    const payload = JSON.stringify(message);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }
}
```

**协议设计**:

```typescript
// 服务器 -> 客户端
{
  type: 'snapshot',
  payload: {
    sessions: [...],
    windows: [...]
  }
}

{
  type: 'session_data',
  payload: {
    uid: 'xxx',
    data: 'terminal output...',
    timestamp: 1234567890
  }
}

// 客户端 -> 服务器
{
  type: 'input',
  payload: {
    uid: 'xxx',
    data: 'ls -la\n'
  }
}

{
  type: 'resize',
  payload: {
    uid: 'xxx',
    cols: 80,
    rows: 24
  }
}
```

### 3.3 集成到现有架构

**修改**: `app/ui/window.ts`

```typescript
// 在 createSession 后注册到状态管理器
const {session, options} = createSession(extraOptions);
stateManager.registerSession({
  uid: options.uid,
  windowId: window.uid,
  windowTitle: window.getTitle(),
  tabIndex: getCurrentTabIndex(),
  shell: session.shell,
  pid: session.pty?.pid,
  // ...
});

// 监听数据流
session.on('data', (data: string) => {
  rpc.emit('session data', data);
  stateManager.onSessionData(options.uid, data); // 新增
});

// 会话退出时注销
session.on('exit', () => {
  rpc.emit('session exit', {uid: options.uid});
  stateManager.unregisterSession(options.uid); // 新增
  sessions.delete(options.uid);
});
```

**修改**: `app/index.ts`

```typescript
import {RemoteTerminalServer} from './remote/websocket-server';

let remoteServer: RemoteTerminalServer | null = null;

app.on('ready', async () => {
  // 启动远程服务器
  const config = getConfig();
  if (config.remoteTerminal?.enabled !== false) {
    const port = config.remoteTerminal?.port || 3030;
    remoteServer = new RemoteTerminalServer(port);
    console.log(`Remote terminal server started at http://localhost:${port}`);
  }

  // ... 现有代码
});

app.on('will-quit', () => {
  remoteServer?.close();
});
```

### 3.4 Web UI 实现

**文件结构**:
```
lib/remote-ui/
├── index.html          # 入口页面
├── index.tsx           # React 入口
├── components/
│   ├── RemoteTerminal.tsx   # 复用 lib/components/term.tsx
│   ├── TerminalGrid.tsx     # 终端网格布局
│   ├── WindowList.tsx       # 窗口/Tab 列表
│   └── StatusBar.tsx        # 连接状态栏
├── hooks/
│   └── useWebSocket.ts      # WebSocket 连接管理
└── store/
    └── remote-store.ts      # 远程状态管理
```

**核心组件**: `lib/remote-ui/components/RemoteTerminal.tsx`

```typescript
import Term from '../../components/term'; // 复用现有组件

interface RemoteTerminalProps {
  sessionInfo: TerminalSessionInfo;
  readonly?: boolean;
}

export const RemoteTerminal: React.FC<RemoteTerminalProps> = ({
  sessionInfo,
  readonly = false
}) => {
  const ws = useWebSocket();
  const termRef = useRef<Term>(null);

  useEffect(() => {
    // 订阅该 session 的数据流
    const handler = (msg: WSMessage) => {
      if (msg.type === 'session_data' && msg.payload.uid === sessionInfo.uid) {
        termRef.current?.write(msg.payload.data);
      }
    };
    ws.on('message', handler);
    return () => ws.off('message', handler);
  }, [sessionInfo.uid]);

  const handleInput = (data: string) => {
    if (!readonly) {
      ws.send({
        type: 'input',
        payload: { uid: sessionInfo.uid, data }
      });
    }
  };

  // 复用 Term 组件，传入相同的 props
  return (
    <Term
      ref={termRef}
      uid={sessionInfo.uid}
      onData={handleInput}
      // ... 其他 props 从 sessionInfo 映射
    />
  );
};
```

**布局组件**: `lib/remote-ui/components/TerminalGrid.tsx`

```typescript
export const TerminalGrid: React.FC = () => {
  const { sessions, windows } = useRemoteStore();
  const [layout, setLayout] = useState<'grid' | 'tabs'>('tabs');

  return (
    <div className="remote-terminal-grid">
      <Sidebar>
        {windows.map(win => (
          <WindowItem key={win.id} window={win}>
            {win.tabs.map(tabUid => (
              <TabItem key={tabUid} session={sessions.get(tabUid)} />
            ))}
          </WindowItem>
        ))}
      </Sidebar>

      <MainArea>
        {layout === 'grid' ? (
          <GridLayout sessions={Array.from(sessions.values())} />
        ) : (
          <TabbedLayout sessions={Array.from(sessions.values())} />
        )}
      </MainArea>
    </div>
  );
};
```

### 3.5 构建配置

**新增**: `vite.config.remote.ts`

```typescript
export default defineConfig({
  build: {
    outDir: 'target/remote-ui',
    rollupOptions: {
      input: 'lib/remote-ui/index.html'
    }
  },
  resolve: {
    alias: {
      // 复用现有组件
      '@components': path.resolve(__dirname, 'lib/components'),
      '@utils': path.resolve(__dirname, 'lib/utils')
    }
  }
});
```

**修改**: `package.json`

```json
{
  "scripts": {
    "build:remote-ui": "vite build --config vite.config.remote.ts",
    "build": "vite build && vite build --config vite.config.cli.ts && pnpm run build:remote-ui && tsc -b"
  }
}
```

## 四、性能优化

### 4.1 数据传输优化 — 二进制协议 + 批处理

终端数据流是高频小包场景，JSON 序列化开销不可忽视。对 `session_data` 这类高频消息使用二进制协议，元数据消息保留 JSON。

```typescript
// app/remote/binary-protocol.ts

/**
 * 二进制消息格式 (session_data 专用):
 * ┌──────────┬──────────────────┬──────────────┬────────────┐
 * │ type (1B)│ uid (36B, ASCII) │ length (4B)  │ data (NB)  │
 * └──────────┴──────────────────┴──────────────┴────────────┘
 */
const MSG_TYPE_SESSION_DATA = 0x01;

export function encodeSessionData(uid: string, data: string): Buffer {
  const dataBuffer = Buffer.from(data, 'utf8');
  const header = Buffer.allocUnsafe(41); // 1 + 36 + 4
  header.writeUInt8(MSG_TYPE_SESSION_DATA, 0);
  header.write(uid, 1, 36, 'ascii');
  header.writeUInt32LE(dataBuffer.length, 37);
  return Buffer.concat([header, dataBuffer]);
}

export function decodeSessionData(buffer: Buffer): { uid: string; data: string } {
  const uid = buffer.toString('ascii', 1, 37).trimEnd();
  const length = buffer.readUInt32LE(37);
  const data = buffer.toString('utf8', 41, 41 + length);
  return { uid, data };
}

export function isBinaryMessage(data: Buffer | string): boolean {
  return Buffer.isBuffer(data) && data.length > 0 && data.readUInt8(0) === MSG_TYPE_SESSION_DATA;
}
```

复用现有 DataBatcher 的 16ms/200KB 策略，对 WebSocket 广播做同样的批处理：

```typescript
// app/remote/ws-data-batcher.ts

class WSDataBatcher {
  private buffer: Buffer[] = [];
  private bufferSize = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly flushIntervalMs = 16;
  private readonly maxBatchSize = 200 * 1024;

  constructor(private onFlush: (batch: Buffer) => void) {}

  write(encoded: Buffer) {
    this.buffer.push(encoded);
    this.bufferSize += encoded.length;

    if (this.bufferSize >= this.maxBatchSize) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.flush();
      return;
    }

    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  flush() {
    if (this.buffer.length === 0) return;
    // 单条直接发送，多条合并
    const batch = this.buffer.length === 1
      ? this.buffer[0]
      : Buffer.concat(this.buffer, this.bufferSize);
    this.buffer = [];
    this.bufferSize = 0;
    this.timer = null;
    this.onFlush(batch);
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.buffer = [];
    this.bufferSize = 0;
  }
}
```

### 4.2 内存管理 — 循环缓冲区 + 活跃度分级

每个 session 的历史输出保存在固定大小的循环缓冲区中，避免无限增长。根据终端活跃度动态调整缓冲区容量。

```typescript
// app/remote/circular-buffer.ts

class CircularBuffer {
  private chunks: string[] = [];
  private totalSize = 0;
  private readonly maxSize: number;

  constructor(maxSizeBytes: number = 2 * 1024 * 1024) { // 默认 2MB
    this.maxSize = maxSizeBytes;
  }

  append(data: string) {
    this.chunks.push(data);
    this.totalSize += data.length;

    // 超出上限时，从头部丢弃
    while (this.totalSize > this.maxSize && this.chunks.length > 1) {
      const removed = this.chunks.shift()!;
      this.totalSize -= removed.length;
    }
  }

  getAll(): string {
    return this.chunks.join('');
  }

  getSize(): number {
    return this.totalSize;
  }

  clear() {
    this.chunks = [];
    this.totalSize = 0;
  }
}
```

活跃度分级策略：

```typescript
// app/remote/state-manager.ts (内存管理部分)

const BUFFER_TIERS = {
  active:   2 * 1024 * 1024,   // 2MB — 5分钟内有输出
  idle:     512 * 1024,         // 512KB — 5~30分钟无输出
  dormant:  64 * 1024,          // 64KB — 超过30分钟无输出
} as const;

class TerminalStateManager extends EventEmitter {
  private buffers = new Map<string, CircularBuffer>();
  private lastActivity = new Map<string, number>();
  private tierCheckInterval: NodeJS.Timeout;

  constructor() {
    super();
    // 每60秒检查一次，降级不活跃终端的缓冲区
    this.tierCheckInterval = setInterval(() => this.adjustBufferTiers(), 60_000);
  }

  onSessionData(uid: string, data: string) {
    this.lastActivity.set(uid, Date.now());
    let buffer = this.buffers.get(uid);
    if (!buffer) {
      buffer = new CircularBuffer(BUFFER_TIERS.active);
      this.buffers.set(uid, buffer);
    }
    buffer.append(data);
    this.emit('session_data', { uid, data });
  }

  private adjustBufferTiers() {
    const now = Date.now();
    for (const [uid, lastTime] of this.lastActivity) {
      const age = now - lastTime;
      const buffer = this.buffers.get(uid);
      if (!buffer) continue;

      let targetSize: number;
      if (age < 5 * 60_000) {
        targetSize = BUFFER_TIERS.active;
      } else if (age < 30 * 60_000) {
        targetSize = BUFFER_TIERS.idle;
      } else {
        targetSize = BUFFER_TIERS.dormant;
      }

      // 只缩小，不扩大（扩大在收到新数据时自动恢复）
      if (targetSize < buffer.getSize()) {
        const data = buffer.getAll();
        buffer.clear();
        // 保留尾部数据
        buffer.append(data.slice(-targetSize));
      }
    }
  }

  destroy() {
    clearInterval(this.tierCheckInterval);
    this.buffers.clear();
    this.lastActivity.clear();
  }
}
```

### 4.3 选择性广播 — 只发送客户端关注的数据

浏览器客户端通过订阅机制声明关注哪些终端，服务器只向其推送对应数据，避免无效广播。

```typescript
// app/remote/subscription-manager.ts

class SubscriptionManager {
  // clientId -> 订阅的 session uid 集合
  private subscriptions = new Map<string, Set<string>>();

  subscribe(clientId: string, sessionUids: string[]) {
    let subs = this.subscriptions.get(clientId);
    if (!subs) {
      subs = new Set();
      this.subscriptions.set(clientId, subs);
    }
    for (const uid of sessionUids) {
      subs.add(uid);
    }
  }

  unsubscribe(clientId: string, sessionUids: string[]) {
    const subs = this.subscriptions.get(clientId);
    if (!subs) return;
    for (const uid of sessionUids) {
      subs.delete(uid);
    }
  }

  // 返回需要接收该 session 数据的客户端列表
  getSubscribers(sessionUid: string): string[] {
    const result: string[] = [];
    for (const [clientId, subs] of this.subscriptions) {
      if (subs.has(sessionUid)) {
        result.push(clientId);
      }
    }
    return result;
  }

  removeClient(clientId: string) {
    this.subscriptions.delete(clientId);
  }
}
```

客户端协议扩展：

```typescript
// 客户端 -> 服务器: 订阅/取消订阅
{ type: 'subscribe',   payload: { uids: ['session-1', 'session-2'] } }
{ type: 'unsubscribe', payload: { uids: ['session-1'] } }

// 默认行为: 新连接时自动订阅当前查看的终端
// 切换 Tab 时自动 subscribe 新终端 + unsubscribe 旧终端
```

### 4.4 历史数据分块发送

浏览器连接时需要接收历史输出，大量数据一次性发送会阻塞事件循环。采用分块 + yield 策略。

```typescript
// app/remote/websocket-server.ts (历史发送部分)

private async sendSessionHistory(ws: WebSocket, uid: string) {
  const history = this.stateManager.getSessionHistory(uid);
  if (!history) return;

  const CHUNK_SIZE = 64 * 1024; // 64KB per chunk

  if (history.length <= CHUNK_SIZE) {
    // 小数据直接发送
    ws.send(JSON.stringify({
      type: 'session_history',
      payload: { uid, data: history, chunk: 0, total: 1 }
    }));
    return;
  }

  // 大数据分块发送
  const totalChunks = Math.ceil(history.length / CHUNK_SIZE);
  for (let i = 0; i < totalChunks; i++) {
    // 检查连接是否还活着
    if (ws.readyState !== WebSocket.OPEN) return;

    const start = i * CHUNK_SIZE;
    const chunk = history.slice(start, start + CHUNK_SIZE);
    ws.send(JSON.stringify({
      type: 'session_history',
      payload: { uid, data: chunk, chunk: i, total: totalChunks }
    }));

    // 让出事件循环，避免阻塞其他连接
    if (i < totalChunks - 1) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }
}
```

### 4.5 高频输出自适应节流

当终端输出速率超过阈值（如 `npm install`、`tail -f` 大日志），自动降低向浏览器推送的频率，保护网络和渲染性能。

```typescript
// app/remote/adaptive-throttler.ts

class AdaptiveThrottler {
  private rates = new Map<string, { bytes: number; windowStart: number }>();
  private readonly windowMs = 1000;           // 1秒统计窗口
  private readonly throttleThreshold = 256 * 1024; // 256KB/s 开始节流
  private readonly hardLimit = 1024 * 1024;        // 1MB/s 硬上限

  /**
   * 返回 true 表示该数据应该被发送，false 表示应该被丢弃/摘要化
   */
  shouldSend(uid: string, dataSize: number): 'send' | 'throttle' | 'drop' {
    const now = Date.now();
    let rate = this.rates.get(uid);

    if (!rate || now - rate.windowStart > this.windowMs) {
      rate = { bytes: 0, windowStart: now };
      this.rates.set(uid, rate);
    }

    rate.bytes += dataSize;

    if (rate.bytes > this.hardLimit) {
      return 'drop';
    }
    if (rate.bytes > this.throttleThreshold) {
      return 'throttle';
    }
    return 'send';
  }

  /**
   * 节流模式: 只保留最后 N 行 + 摘要
   */
  summarize(data: string): string {
    const lines = data.split('\n');
    if (lines.length <= 5) return data;
    return `\x1b[2m[... ${lines.length - 3} lines throttled ...]\x1b[0m\n` +
           lines.slice(-3).join('\n');
  }
}
```

集成到广播流程：

```typescript
// app/remote/websocket-server.ts (广播部分)

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
      return; // 完全丢弃，不发送
  }

  const subscribers = this.subscriptionManager.getSubscribers(uid);
  for (const clientId of subscribers) {
    const ws = this.clients.get(clientId);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}
```

### 4.6 Web UI 渲染优化 — 虚拟化 + 懒加载

浏览器同时打开多个 xterm 实例会消耗大量内存和 GPU 资源。只渲染当前可见的终端。

```typescript
// lib/remote-ui/components/TerminalGrid.tsx

export const TerminalGrid: React.FC<{ sessions: TerminalSessionInfo[] }> = ({ sessions }) => {
  const [activeUid, setActiveUid] = useState<string | null>(null);
  const ws = useWebSocket();

  // 切换终端时，自动管理订阅
  const prevUid = useRef<string | null>(null);
  useEffect(() => {
    if (prevUid.current && prevUid.current !== activeUid) {
      ws.send({ type: 'unsubscribe', payload: { uids: [prevUid.current] } });
    }
    if (activeUid) {
      ws.send({ type: 'subscribe', payload: { uids: [activeUid] } });
    }
    prevUid.current = activeUid;
  }, [activeUid]);

  return (
    <div className="terminal-grid">
      <Sidebar sessions={sessions} activeUid={activeUid} onSelect={setActiveUid} />
      <main>
        {/* 只渲染当前选中的终端，其余销毁 xterm 实例释放内存 */}
        {activeUid && (
          <RemoteTerminal
            key={activeUid}
            sessionInfo={sessions.find(s => s.uid === activeUid)!}
          />
        )}
      </main>
    </div>
  );
};
```

### 4.7 性能预期

| 场景 | 终端数 | 内存增量 | CPU 增量 | 端到端延迟 |
| ---- | ------ | -------- | -------- | ---------- |
| 日常使用 | 1-10 | ~20-50 MB | < 5% | 20-40ms |
| 中度使用 | 10-30 | ~50-150 MB | 5-15% | 30-60ms |
| 重度使用 | 30-50 | ~150-300 MB | 15-30% | 50-100ms |
| 高频输出 (npm install) | 10 | ~80 MB | 10-20% | 50-80ms (节流后) |
| 极端场景 (tail -f 大日志) | 10 | ~100 MB | 15-25% | 自适应节流 |

> 内存增量指 StateManager + 缓冲区的额外开销，不含浏览器端 xterm 实例。
> 浏览器端因为只渲染当前可见终端，单个 xterm 实例约 10-20MB。

## 五、安全性设计

### 5.1 访问控制

```typescript
interface RemoteConfig {
  enabled: boolean;
  port: number;
  host: string; // 默认 'localhost'，只允许本地访问
  auth?: {
    type: 'token' | 'none';
    token?: string; // 随机生成的访问令牌
  };
  allowedOrigins?: string[]; // CORS 白名单
}

// 配置示例
{
  remoteTerminal: {
    enabled: true,
    port: 3030,
    host: '127.0.0.1', // 只监听本地
    auth: {
      type: 'token',
      token: 'auto' // 自动生成并显示在 App 中
    }
  }
}
```

### 5.2 令牌认证

```typescript
class RemoteTerminalServer {
  private authToken: string;

  constructor(config: RemoteConfig) {
    this.authToken = config.auth?.token === 'auto'
      ? crypto.randomBytes(32).toString('hex')
      : config.auth?.token || '';

    // 在 App 中显示访问 URL
    this.showAccessURL();
  }

  private setupWebSocket() {
    this.wss.on('connection', (ws, req) => {
      const token = new URL(req.url!, 'ws://localhost').searchParams.get('token');

      if (this.authToken && token !== this.authToken) {
        ws.close(1008, 'Unauthorized');
        return;
      }

      // ... 正常处理
    });
  }

  private showAccessURL() {
    const url = `http://localhost:${this.port}?token=${this.authToken}`;
    console.log(`\n🌐 Remote Terminal URL:\n${url}\n`);

    // 可选：在 App 中显示通知
    notify('Remote Terminal Ready', `Access at: ${url}`);
  }
}
```

### 5.3 输入验证

```typescript
private handleClientMessage(ws: WebSocket, data: Buffer) {
  try {
    const message: WSMessage = JSON.parse(data.toString());

    // 验证消息格式
    if (!message.type || !message.payload) {
      throw new Error('Invalid message format');
    }

    // 验证 session UID 存在
    if (message.type === 'input' || message.type === 'resize') {
      const uid = message.payload.uid;
      if (!this.stateManager.hasSession(uid)) {
        throw new Error('Session not found');
      }
    }

    // 限制输入长度
    if (message.type === 'input') {
      const data = message.payload.data;
      if (data.length > 10000) {
        throw new Error('Input too long');
      }
    }

    this.processMessage(message);
  } catch (err) {
    console.error('Invalid client message:', err);
    ws.send(JSON.stringify({ type: 'error', payload: { message: err.message } }));
  }
}
```

## 六、配置选项

**修改**: `typings/config.d.ts`

```typescript
export interface configOptions {
  // ... 现有配置

  remoteTerminal?: {
    enabled?: boolean;        // 默认 true
    port?: number;            // 默认 3030
    host?: string;            // 默认 '127.0.0.1'
    maxHistoryLines?: number; // 默认 10000
    auth?: {
      type?: 'token' | 'none'; // 默认 'token'
      token?: string;          // 默认 'auto'
    };
    features?: {
      allowInput?: boolean;    // 默认 true，允许远程输入
      allowResize?: boolean;   // 默认 false，允许远程调整大小
    };
  };
}
```

**默认配置**: `app/config/index.ts`

```typescript
export const defaults: configOptions = {
  // ... 现有默认值

  remoteTerminal: {
    enabled: true,
    port: 3030,
    host: '127.0.0.1',
    maxHistoryLines: 10000,
    auth: {
      type: 'token',
      token: 'auto'
    },
    features: {
      allowInput: true,
      allowResize: false
    }
  }
};
```

## 6.5 测试策略

### 测试框架

沿用项目现有的 AVA 测试框架，测试文件位于 `test/unit/` 目录，遵循 `*.test.ts` 命名规范。

### 单元测试覆盖

所有 Phase 1 核心组件均有完整的单元测试（共 71 个测试用例）：

| 模块 | 测试文件 | 用例数 | 覆盖范围 |
| ---- | -------- | ------ | -------- |
| CircularBuffer | `circular-buffer.test.ts` | 10 | 容量管理、溢出丢弃、resize、边界条件 |
| BinaryProtocol | `binary-protocol.test.ts` | 13 | 编解码往返、header 格式、Unicode/ANSI、大数据、类型判断 |
| WSDataBatcher | `ws-data-batcher.test.ts` | 7 | 单条/多条 flush、定时器触发、超阈值自动 flush、destroy 清理 |
| SubscriptionManager | `subscription-manager.test.ts` | 12 | 订阅/取消订阅、去重、多客户端交叉订阅、客户端移除 |
| AdaptiveThrottler | `adaptive-throttler.test.ts` | 11 | 三级阈值判定、窗口重置、独立 session 追踪、summarize 截断、累积计算 |
| TerminalStateManager | `state-manager.test.ts` | 18 | 注册/注销、窗口分组、事件触发、历史缓冲、destroy 清理 |

Phase 2 Web UI 相关测试（共 36 个测试用例）：

| 模块 | 测试文件 | 用例数 | 覆盖范围 |
| ---- | -------- | ------ | -------- |
| BinaryProtocol (Browser) | `binary-protocol-browser.test.ts` | 14 | 浏览器端 ArrayBuffer 解码、多消息拼接、截断处理、与服务端编码器兼容性 |
| RemoteStore (Reducer) | `remote-store.test.ts` | 22 | 所有 action 分支、快照/增删会话、活跃会话自动切换、连接状态、错误处理 |

Phase 3 Web UI 功能测试（共 16 个测试用例）：

| 模块 | 测试文件 | 用例数 | 覆盖范围 |
| ---- | -------- | ------ | -------- |
| RemoteStore Phase3 | `remote-store-phase3.test.ts` | 16 | 布局模式切换、历史分块进度追踪、窗口折叠/展开、会话移除清理历史状态、初始状态验证 |

### 测试设计原则

1. **纯单元测试**: 每个组件独立测试，无外部依赖（无 Electron、无网络）
2. **边界条件覆盖**: 空输入、超限输入、重复操作、不存在的 ID 等
3. **异步行为验证**: 定时器触发、窗口过期等时间相关逻辑
4. **事件驱动验证**: 确认 EventEmitter 在正确时机触发正确事件
5. **资源清理验证**: destroy/clear 后状态完全重置，无内存泄漏

### 运行测试

```bash
# 运行所有单元测试
pnpm run test:unit

# 运行远程终端相关测试
npx ava test/unit/circular-buffer.test.ts test/unit/binary-protocol.test.ts test/unit/subscription-manager.test.ts test/unit/adaptive-throttler.test.ts test/unit/ws-data-batcher.test.ts test/unit/state-manager.test.ts
```

### 后续测试计划

| 阶段 | 测试类型 | 内容 |
| ---- | -------- | ---- |
| Phase 3 | 组件测试 | Web UI React 组件渲染、交互 |
| Phase 4 | E2E 测试 | 完整流程：启动 App → 打开浏览器 → 查看终端 → 输入交互 |
| Phase 4 | 性能测试 | 多终端并发、高频输出、内存占用基准 |

## 七、实现路线图

### Phase 1: 核心基础设施 (Week 1) ✅

- [x] 实现 TerminalStateManager
- [x] 实现 WebSocket 服务器基础框架
- [x] 集成到 app/index.ts 和 app/ui/window.ts
- [x] 基础配置系统
- [x] 性能优化组件（二进制协议、批处理、选择性广播、自适应节流、循环缓冲区）
- [x] 单元测试覆盖

### Phase 2: Web UI 基础 (Week 2) ✅

- [x] 搭建 Web UI 项目结构 (`lib/remote-ui/`)
- [x] 实现 WebSocket 客户端连接 (`useWebSocket` hook + 自动重连)
- [x] 浏览器端二进制协议解码 (`binary-protocol-browser.ts`)
- [x] React Context 状态管理 (`remote-store.tsx`)
- [x] 轻量 xterm.js 浏览器包装组件 (`RemoteTerminal.tsx`)
- [x] 会话列表侧边栏 (`WindowList.tsx`)
- [x] 连接状态栏 (`StatusBar.tsx`)
- [x] 独立 Vite 构建配置 (`vite.config.remote.ts`)
- [x] 服务端静态文件服务集成
- [x] 单元测试覆盖（36 个用例）

### Phase 3: 完整功能 (Week 3) ✅

- [x] 多终端网格/标签布局
- [x] 窗口/Tab 层级显示
- [x] 远程输入功能
- [x] 历史输出回放

### Phase 4: 优化和安全 (Week 4)

- [ ] 性能优化（数据压缩、批处理）
- [ ] 令牌认证系统
- [ ] 错误处理和重连机制
- [ ] 文档和测试

## 八、扩展能力

基于此架构，未来可以轻松扩展：

1. **多设备同步**: 通过云端中继实现跨设备访问
2. **协作模式**: 多人同时查看/操作同一终端
3. **录制回放**: 记录终端会话并回放
4. **AI 辅助**: 集成 AI 分析终端输出，提供智能建议
5. **移动端 App**: 使用相同的 WebSocket 协议开发移动客户端
6. **插件系统**: 允许第三方扩展远程功能

## 九、关键优势

1. **零侵入**: 不改变现有终端逻辑，只添加观察者
2. **高性能**: 复用现有的 DataBatcher，优化数据传输
3. **完全一致**: Web UI 使用相同组件，体验完全一致
4. **可扩展**: 清晰的分层架构，易于添加新功能
5. **安全**: 默认只监听本地，支持令牌认证
6. **灵活**: 支持只读/交互模式，可配置各种行为

## 十、技术亮点

1. **事件驱动架构**: 利用 EventEmitter 实现松耦合
2. **状态集中管理**: 单一数据源，避免状态不一致
3. **组件复用**: 最大化复用现有代码，减少维护成本
4. **渐进增强**: 可以逐步添加功能，不影响现有功能
5. **性能优先**: 从设计层面考虑性能，使用批处理、压缩等技术
