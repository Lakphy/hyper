import React, {createContext, useContext, useReducer} from 'react';
import type {TerminalSessionInfo, WindowInfo, ConnectionStatus} from '../types';

export interface RemoteState {
  sessions: TerminalSessionInfo[];
  windows: WindowInfo[];
  activeSessionUid: string | null;
  connectionStatus: ConnectionStatus;
  lastError: string | null;
}

const initialState: RemoteState = {
  sessions: [],
  windows: [],
  activeSessionUid: null,
  connectionStatus: 'connecting',
  lastError: null
};

export type RemoteAction =
  | {type: 'SET_SNAPSHOT'; payload: {sessions: TerminalSessionInfo[]; windows: WindowInfo[]}}
  | {type: 'ADD_SESSION'; payload: TerminalSessionInfo}
  | {type: 'REMOVE_SESSION'; payload: {uid: string}}
  | {type: 'SET_ACTIVE_SESSION'; payload: string | null}
  | {type: 'SET_CONNECTION_STATUS'; payload: ConnectionStatus}
  | {type: 'SET_ERROR'; payload: string | null};

export function remoteReducer(state: RemoteState, action: RemoteAction): RemoteState {
  switch (action.type) {
    case 'SET_SNAPSHOT': {
      const {sessions, windows} = action.payload;
      // Auto-select first session if none active
      const activeSessionUid =
        state.activeSessionUid && sessions.some((s) => s.uid === state.activeSessionUid)
          ? state.activeSessionUid
          : sessions[0]?.uid ?? null;
      return {...state, sessions, windows, activeSessionUid};
    }
    case 'ADD_SESSION': {
      const session = action.payload;
      const sessions = [...state.sessions, session];
      // Update window info
      const windows = state.windows.map((w) => {
        if (w.uid === session.windowId && !w.sessions.includes(session.uid)) {
          return {...w, sessions: [...w.sessions, session.uid]};
        }
        return w;
      });
      // Add window if it doesn't exist
      const windowExists = windows.some((w) => w.uid === session.windowId);
      if (!windowExists) {
        windows.push({uid: session.windowId, title: session.windowTitle, sessions: [session.uid]});
      }
      // Auto-select if first session
      const activeSessionUid = state.activeSessionUid ?? session.uid;
      return {...state, sessions, windows, activeSessionUid};
    }
    case 'REMOVE_SESSION': {
      const {uid} = action.payload;
      const sessions = state.sessions.filter((s) => s.uid !== uid);
      const windows = state.windows
        .map((w) => ({...w, sessions: w.sessions.filter((s) => s !== uid)}))
        .filter((w) => w.sessions.length > 0);
      const activeSessionUid =
        state.activeSessionUid === uid ? (sessions[0]?.uid ?? null) : state.activeSessionUid;
      return {...state, sessions, windows, activeSessionUid};
    }
    case 'SET_ACTIVE_SESSION':
      return {...state, activeSessionUid: action.payload};
    case 'SET_CONNECTION_STATUS':
      return {...state, connectionStatus: action.payload};
    case 'SET_ERROR':
      return {...state, lastError: action.payload};
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
