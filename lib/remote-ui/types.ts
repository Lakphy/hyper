/** Shared types for the remote terminal Web UI */

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
  sessions: string[];
}

// Messages sent by the server
export type WSServerMessage =
  | {type: 'snapshot'; payload: {sessions: TerminalSessionInfo[]; windows: WindowInfo[]}}
  | {type: 'session_added'; payload: TerminalSessionInfo}
  | {type: 'session_removed'; payload: {uid: string}}
  | {type: 'session_updated'; payload: {uid: string; changes: Partial<TerminalSessionInfo>}}
  | {type: 'session_history'; payload: {uid: string; data: string; chunk: number; total: number}}
  | {type: 'error'; payload: {message: string}};

// Messages sent by the client
export type WSClientMessage =
  | {type: 'subscribe'; payload: {uids: string[]}}
  | {type: 'unsubscribe'; payload: {uids: string[]}}
  | {type: 'input'; payload: {uid: string; data: string}}
  | {type: 'resize'; payload: {uid: string; cols: number; rows: number}};

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
