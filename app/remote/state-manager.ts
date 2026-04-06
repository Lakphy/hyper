import {EventEmitter} from 'events';
import {CircularBuffer} from './circular-buffer';

export interface TerminalSessionInfo {
  uid: string;
  windowId: string;
  windowTitle: string;
  tabIndex: number;
  shell: string;
  pid: number | null;
  cwd?: string;
  profile?: string;
  cols?: number;
  rows?: number;
  createdAt: number;
}

export interface WindowInfo {
  uid: string;
  title: string;
  sessions: string[]; // session uids
}

const BUFFER_TIERS = {
  active: 2 * 1024 * 1024, // 2MB - output within 5 minutes
  idle: 512 * 1024, // 512KB - no output for 5~30 minutes
  dormant: 64 * 1024 // 64KB - no output for 30+ minutes
} as const;

/**
 * TerminalStateManager - Central state management for all terminal sessions
 * Tracks sessions, windows, and maintains circular buffers for history
 */
export class TerminalStateManager extends EventEmitter {
  private sessions = new Map<string, TerminalSessionInfo>();
  private windows = new Map<string, WindowInfo>();
  private buffers = new Map<string, CircularBuffer>();
  private lastActivity = new Map<string, number>();
  private tierCheckInterval: NodeJS.Timeout;

  constructor() {
    super();
    // Check every 60 seconds to downgrade inactive terminal buffers
    this.tierCheckInterval = setInterval(() => this.adjustBufferTiers(), 60_000);
  }

  registerSession(info: TerminalSessionInfo) {
    this.sessions.set(info.uid, info);
    this.lastActivity.set(info.uid, Date.now());
    this.buffers.set(info.uid, new CircularBuffer(BUFFER_TIERS.active));

    // Update window info
    let windowInfo = this.windows.get(info.windowId);
    if (!windowInfo) {
      windowInfo = {
        uid: info.windowId,
        title: info.windowTitle,
        sessions: []
      };
      this.windows.set(info.windowId, windowInfo);
    }
    if (!windowInfo.sessions.includes(info.uid)) {
      windowInfo.sessions.push(info.uid);
    }

    this.emit('session_added', info);
  }

  unregisterSession(uid: string) {
    const session = this.sessions.get(uid);
    if (!session) return;

    // Remove from window
    const windowInfo = this.windows.get(session.windowId);
    if (windowInfo) {
      windowInfo.sessions = windowInfo.sessions.filter((s) => s !== uid);
      if (windowInfo.sessions.length === 0) {
        this.windows.delete(session.windowId);
      }
    }

    this.sessions.delete(uid);
    this.buffers.delete(uid);
    this.lastActivity.delete(uid);

    this.emit('session_removed', {uid});
  }

  onSessionData(uid: string, data: string) {
    this.lastActivity.set(uid, Date.now());
    let buffer = this.buffers.get(uid);
    if (!buffer) {
      buffer = new CircularBuffer(BUFFER_TIERS.active);
      this.buffers.set(uid, buffer);
    }
    buffer.append(data);
    this.emit('session_data', {uid, data});
  }

  getSessionHistory(uid: string): string | null {
    const buffer = this.buffers.get(uid);
    return buffer ? buffer.getAll() : null;
  }

  getAllSessions(): TerminalSessionInfo[] {
    return Array.from(this.sessions.values());
  }

  getAllWindows(): WindowInfo[] {
    return Array.from(this.windows.values());
  }

  getSession(uid: string): TerminalSessionInfo | undefined {
    return this.sessions.get(uid);
  }

  updateSession(uid: string, changes: Partial<TerminalSessionInfo>) {
    const session = this.sessions.get(uid);
    if (!session) return;
    Object.assign(session, changes);
    this.emit('session_updated', {uid, changes});
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

      // Only shrink, don't expand (expansion happens automatically on new data)
      if (targetSize < buffer.getSize()) {
        buffer.resize(targetSize);
      }
    }
  }

  destroy() {
    clearInterval(this.tierCheckInterval);
    this.buffers.clear();
    this.lastActivity.clear();
    this.sessions.clear();
    this.windows.clear();
    this.removeAllListeners();
  }
}
