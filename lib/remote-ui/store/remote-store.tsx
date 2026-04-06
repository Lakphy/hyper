import React, {createContext, useContext, useReducer} from 'react';

import type {TerminalSessionInfo, WindowInfo, ConnectionStatus} from '../types';

export interface RemoteState {
  sessions: TerminalSessionInfo[];
  windows: WindowInfo[];
  activeSessionUid: string | null;
  connectionStatus: ConnectionStatus;
  lastError: string | null;
  layoutMode: 'tabs' | 'grid';
  historyLoading: Record<string, {received: number; total: number}>;
  collapsedWindows: Record<string, boolean>;
  subscribedUids: string[];
}

const initialState: RemoteState = {
  sessions: [],
  windows: [],
  activeSessionUid: null,
  connectionStatus: 'connecting',
  lastError: null,
  layoutMode: 'tabs',
  historyLoading: {},
  collapsedWindows: {},
  subscribedUids: []
};

export type RemoteAction =
  | {type: 'SET_SNAPSHOT'; payload: {sessions: TerminalSessionInfo[]; windows: WindowInfo[]}}
  | {type: 'ADD_SESSION'; payload: TerminalSessionInfo}
  | {type: 'REMOVE_SESSION'; payload: {uid: string}}
  | {type: 'SET_ACTIVE_SESSION'; payload: string | null}
  | {type: 'SET_CONNECTION_STATUS'; payload: ConnectionStatus}
  | {type: 'SET_ERROR'; payload: string | null}
  | {type: 'SET_LAYOUT_MODE'; payload: 'tabs' | 'grid'}
  | {type: 'HISTORY_CHUNK_RECEIVED'; payload: {uid: string; chunk: number; total: number}}
  | {type: 'HISTORY_COMPLETE'; payload: {uid: string}}
  | {type: 'TOGGLE_WINDOW_COLLAPSED'; payload: string}
  | {type: 'SET_SUBSCRIBED_UIDS'; payload: string[]}
  | {type: 'UPDATE_SESSION'; payload: {uid: string; changes: Partial<TerminalSessionInfo>}};

export function remoteReducer(state: RemoteState, action: RemoteAction): RemoteState {
  switch (action.type) {
    case 'SET_SNAPSHOT': {
      const {sessions, windows} = action.payload;
      const activeSessionUid =
        state.activeSessionUid && sessions.some((s) => s.uid === state.activeSessionUid)
          ? state.activeSessionUid
          : sessions[0]?.uid ?? null;
      return {...state, sessions, windows, activeSessionUid};
    }
    case 'ADD_SESSION': {
      const session = action.payload;
      const sessions = [...state.sessions, session];
      const windows = state.windows.map((w) => {
        if (w.uid === session.windowId && !w.sessions.includes(session.uid)) {
          return {...w, sessions: [...w.sessions, session.uid]};
        }
        return w;
      });
      const windowExists = windows.some((w) => w.uid === session.windowId);
      if (!windowExists) {
        windows.push({uid: session.windowId, title: session.windowTitle, sessions: [session.uid]});
      }
      const activeSessionUid = state.activeSessionUid ?? session.uid;
      return {...state, sessions, windows, activeSessionUid};
    }
    case 'REMOVE_SESSION': {
      const {uid} = action.payload;
      const sessions = state.sessions.filter((s) => s.uid !== uid);
      const windows = state.windows
        .map((w) => ({...w, sessions: w.sessions.filter((s) => s !== uid)}))
        .filter((w) => w.sessions.length > 0);
      const activeSessionUid = state.activeSessionUid === uid ? sessions[0]?.uid ?? null : state.activeSessionUid;
      // Clean up history loading for removed session
      const historyLoading = {...state.historyLoading};
      delete historyLoading[uid];
      return {...state, sessions, windows, activeSessionUid, historyLoading};
    }
    case 'SET_ACTIVE_SESSION':
      return {...state, activeSessionUid: action.payload};
    case 'SET_CONNECTION_STATUS':
      return {...state, connectionStatus: action.payload};
    case 'SET_ERROR':
      return {...state, lastError: action.payload};
    case 'SET_LAYOUT_MODE':
      return {...state, layoutMode: action.payload};
    case 'HISTORY_CHUNK_RECEIVED': {
      const {uid, chunk, total} = action.payload;
      return {
        ...state,
        historyLoading: {
          ...state.historyLoading,
          [uid]: {received: chunk + 1, total}
        }
      };
    }
    case 'HISTORY_COMPLETE': {
      const historyLoading = {...state.historyLoading};
      delete historyLoading[action.payload.uid];
      return {...state, historyLoading};
    }
    case 'TOGGLE_WINDOW_COLLAPSED': {
      const windowUid = action.payload;
      return {
        ...state,
        collapsedWindows: {
          ...state.collapsedWindows,
          [windowUid]: !state.collapsedWindows[windowUid]
        }
      };
    }
    case 'SET_SUBSCRIBED_UIDS':
      return {...state, subscribedUids: action.payload};
    case 'UPDATE_SESSION': {
      const {uid, changes} = action.payload;
      const sessions = state.sessions.map((s) => (s.uid === uid ? {...s, ...changes} : s));
      return {...state, sessions};
    }
    default:
      return state;
  }
}

interface RemoteContextValue {
  state: RemoteState;
  dispatch: React.Dispatch<RemoteAction>;
}

const RemoteContext = createContext<RemoteContextValue | null>(null);

export function RemoteProvider({children}: {children: React.ReactNode}) {
  const [state, dispatch] = useReducer(remoteReducer, initialState);
  return <RemoteContext.Provider value={{state, dispatch}}>{children}</RemoteContext.Provider>;
}

export function useRemoteStore() {
  const ctx = useContext(RemoteContext);
  if (!ctx) throw new Error('useRemoteStore must be used within RemoteProvider');
  return ctx;
}
