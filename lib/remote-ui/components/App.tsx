import React, {useRef, useEffect, useCallback, useMemo} from 'react';
import {useRemoteStore} from '../store/remote-store';
import {useWebSocket, sessionDataBus, SessionDataEvent} from '../hooks/useWebSocket';
import {TerminalGrid} from './TerminalGrid';
import {WindowList} from './WindowList';
import {StatusBar} from './StatusBar';
import type {RemoteTerminalHandle} from './RemoteTerminal';

interface AppProps {
  token: string;
}

export function App({token}: AppProps) {
  const {state} = useRemoteStore();
  const {send} = useWebSocket(token);
  const termRefs = useRef<Map<string, RemoteTerminalHandle | null>>(new Map());
  const activeUid = state.activeSessionUid;
  const prevVisibleRef = useRef<string[]>([]);

  // Compute visible uids based on layout mode
  const visibleUids = useMemo(() => {
    if (!activeUid) return [];
    if (state.layoutMode === 'tabs') return [activeUid];
    // Grid mode: show all sessions from the active session's window
    const activeSession = state.sessions.find((s) => s.uid === activeUid);
    if (!activeSession) return [activeUid];
    const activeWindow = state.windows.find((w) => w.uid === activeSession.windowId);
    return activeWindow ? activeWindow.sessions : [activeUid];
  }, [activeUid, state.layoutMode, state.sessions, state.windows]);

  // Manage subscriptions based on visible uids
  useEffect(() => {
    if (visibleUids.length === 0) return;

    const prevSet = new Set(prevVisibleRef.current);
    const newSet = new Set(visibleUids);

    const toSubscribe = visibleUids.filter((uid) => !prevSet.has(uid));
    const toUnsubscribe = prevVisibleRef.current.filter((uid) => !newSet.has(uid));

    if (toUnsubscribe.length > 0) {
      send({type: 'unsubscribe', payload: {uids: toUnsubscribe}});
    }
    if (toSubscribe.length > 0) {
      send({type: 'subscribe', payload: {uids: toSubscribe}});
    }

    prevVisibleRef.current = visibleUids;
  }, [visibleUids, send]);

  // Route session data to the correct terminal ref
  useEffect(() => {
    const handler = (event: Event) => {
      const e = event as SessionDataEvent;
      const ref = termRefs.current.get(e.uid);
      ref?.write(e.data);
    };

    sessionDataBus.addEventListener('session_data', handler);
    return () => {
      sessionDataBus.removeEventListener('session_data', handler);
    };
  }, []);

  const handleData = useCallback(
    (uid: string, data: string) => {
      send({type: 'input', payload: {uid, data}});
    },
    [send]
  );

  const handleResize = useCallback(
    (uid: string, cols: number, rows: number) => {
      send({type: 'resize', payload: {uid, cols, rows}});
    },
    [send]
  );

  return (
    <div className="app">
      <WindowList />
      <div className="main-area">
        {visibleUids.length > 0 ? (
          <TerminalGrid
            visibleUids={visibleUids}
            activeUid={activeUid}
            termRefs={termRefs}
            onData={handleData}
            onResize={handleResize}
          />
        ) : (
          <div className="no-session">
            <p>No active terminal sessions</p>
            <p className="no-session-hint">Open a terminal in Hyper to get started</p>
          </div>
        )}
      </div>
      <StatusBar />
    </div>
  );
}
