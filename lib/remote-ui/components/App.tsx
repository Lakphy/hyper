import React, {useRef, useEffect, useCallback} from 'react';
import {useRemoteStore} from '../store/remote-store';
import {useWebSocket, sessionDataBus, SessionDataEvent} from '../hooks/useWebSocket';
import {RemoteTerminal} from './RemoteTerminal';
import {WindowList} from './WindowList';
import {StatusBar} from './StatusBar';
import type {RemoteTerminalHandle} from './RemoteTerminal';

interface AppProps {
  token: string;
}

export function App({token}: AppProps) {
  const {state} = useRemoteStore();
  const {send} = useWebSocket(token);
  const termRef = useRef<RemoteTerminalHandle>(null);
  const activeUid = state.activeSessionUid;
  const prevUidRef = useRef<string | null>(null);

  // Subscribe to active session and write incoming data
  useEffect(() => {
    if (!activeUid) return;

    const handler = (event: Event) => {
      const e = event as SessionDataEvent;
      if (e.uid === activeUid) {
        termRef.current?.write(e.data);
      }
    };

    sessionDataBus.addEventListener('session_data', handler);

    // Manage subscriptions
    if (prevUidRef.current && prevUidRef.current !== activeUid) {
      send({type: 'unsubscribe', payload: {uids: [prevUidRef.current]}});
    }
    send({type: 'subscribe', payload: {uids: [activeUid]}});
    prevUidRef.current = activeUid;

    return () => {
      sessionDataBus.removeEventListener('session_data', handler);
    };
  }, [activeUid, send]);

  const handleData = useCallback(
    (data: string) => {
      if (activeUid) {
        send({type: 'input', payload: {uid: activeUid, data}});
      }
    },
    [activeUid, send]
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      if (activeUid) {
        send({type: 'resize', payload: {uid: activeUid, cols, rows}});
      }
    },
    [activeUid, send]
  );

  return (
    <div className="app">
      <WindowList />
      <div className="main-area">
        {activeUid ? (
          <RemoteTerminal
            key={activeUid}
            ref={termRef}
            uid={activeUid}
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
