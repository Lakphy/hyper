import React, {useRef, useEffect, useCallback, useMemo, useState} from 'react';

import {useWebSocket, sessionDataBus} from '../hooks/useWebSocket';
import type {SessionDataEvent} from '../hooks/useWebSocket';
import {useRemoteStore} from '../store/remote-store';
import type {WindowInfo} from '../types';

import {RemoteTerminal} from './RemoteTerminal';
import type {RemoteTerminalHandle} from './RemoteTerminal';

interface AppProps {
  token: string;
}

export function App({token}: AppProps) {
  const {state, dispatch} = useRemoteStore();
  const {send} = useWebSocket(token);
  const termRefs = useRef<Map<string, RemoteTerminalHandle | null>>(new Map());
  const activeUid = state.activeSessionUid;
  const prevVisibleRef = useRef<string[]>([]);
  const [windowDropdownOpen, setWindowDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setWindowDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // The active session and its window
  const activeSession = useMemo(() => state.sessions.find((s) => s.uid === activeUid), [state.sessions, activeUid]);
  const activeWindow = useMemo(
    () => state.windows.find((w) => w.uid === activeSession?.windowId),
    [state.windows, activeSession]
  );

  // Build tabs: sessions belonging to the active window
  const tabs = useMemo(() => {
    if (!activeWindow) return [];
    return activeWindow.sessions
      .map((uid) => state.sessions.find((s) => s.uid === uid))
      .filter(Boolean) as typeof state.sessions;
  }, [activeWindow, state.sessions]);

  // Only the active session is visible (tab mode)
  const visibleUids = useMemo(() => {
    return activeUid ? [activeUid] : [];
  }, [activeUid]);

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

    dispatch({type: 'SET_SUBSCRIBED_UIDS', payload: visibleUids});
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

  const handleTabSelect = useCallback(
    (uid: string) => {
      dispatch({type: 'SET_ACTIVE_SESSION', payload: uid});
    },
    [dispatch]
  );

  const handleCreateTab = useCallback(() => {
    // Create a new tab in the current active window
    send({type: 'create_tab', payload: {windowId: activeWindow?.uid}});
  }, [send, activeWindow]);

  // Determine title for single-tab mode
  const singleTabTitle = useMemo(() => {
    if (tabs.length === 1 && activeSession) {
      const shell = activeSession.shell ? activeSession.shell.split('/').pop() : 'shell';
      return `${shell}${activeSession.pid ? ` (${activeSession.pid})` : ''}`;
    }
    return null;
  }, [tabs, activeSession]);

  const showTabs = tabs.length > 1;
  const {historyLoading, connectionStatus} = state;

  return (
    <div className="hyper-remote">
      {/* Header with tab bar */}
      <header className="header">
        <nav className="tabs-nav">
          {/* Single tab: show centered title */}
          {tabs.length === 1 && singleTabTitle ? <div className="tabs-title">{singleTabTitle}</div> : null}

          {/* Multiple tabs: show tab list */}
          {showTabs ? (
            <ul className="tabs-list">
              {tabs.map((session, i) => {
                const isActive = session.uid === activeUid;
                const isFirst = i === 0;
                const shell = session.shell ? session.shell.split('/').pop() : 'shell';
                const title = `${shell}${session.pid ? ` (${session.pid})` : ''}`;
                return (
                  <li
                    key={session.uid}
                    className={`tab ${isFirst ? 'tab--first' : ''} ${isActive ? 'tab--active' : ''} ${
                      isFirst && isActive ? 'tab--first-active' : ''
                    }`}
                  >
                    <span className="tab-text" onClick={() => handleTabSelect(session.uid)}>
                      <span className="tab-text-inner" title={title}>
                        {title}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {/* No sessions: empty space */}
          {tabs.length === 0 && <div className="tabs-title">Hyper Remote</div>}

          {/* New tab button */}
          <div
            className={`new-tab ${tabs.length > 0 ? 'new-tab--visible' : 'new-tab--hidden'}`}
            title="New Tab"
            onClick={handleCreateTab}
          >
            +
          </div>

          {/* Connection status indicator */}
          <div className="connection-indicator">
            <span className={`connection-dot connection-dot--${connectionStatus}`} />
          </div>

          {/* Window selector dropdown */}
          {state.windows.length > 0 && (
            <div
              className="window-selector"
              ref={dropdownRef}
              onClick={() => setWindowDropdownOpen(!windowDropdownOpen)}
            >
              <span className="window-selector-icon">{state.windows.length > 1 ? `${state.windows.length}` : ''}</span>
              <span>&#9662;</span>
              {windowDropdownOpen && (
                <div className="window-dropdown">
                  {state.windows.map((win: WindowInfo, wi: number) => {
                    const isCurrentWindow = win.uid === activeWindow?.uid;
                    return (
                      <div key={win.uid} className="window-dropdown-group">
                        {wi > 0 && <div className="window-dropdown-separator" />}
                        <div className="window-dropdown-header">{win.title || `Window ${wi + 1}`}</div>
                        {win.sessions.map((sessionUid) => {
                          const session = state.sessions.find((s) => s.uid === sessionUid);
                          if (!session) return null;
                          const shell = session.shell ? session.shell.split('/').pop() : 'shell';
                          const isCurrent = session.uid === activeUid;
                          return (
                            <button
                              key={sessionUid}
                              className={`window-dropdown-item ${
                                isCurrent ? 'window-dropdown-item--current' : ''
                              } ${isCurrentWindow ? 'window-dropdown-item--active' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleTabSelect(sessionUid);
                                setWindowDropdownOpen(false);
                              }}
                            >
                              <span>{shell}</span>
                              {session.pid && <span style={{color: '#666', fontSize: 11}}>{session.pid}</span>}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </nav>
      </header>

      {/* Terminal Area */}
      <div className="terms">
        {activeUid ? (
          <div className="remote-terminal">
            {historyLoading[activeUid] && (
              <div className="history-loading">
                Loading history ({historyLoading[activeUid].received}/{historyLoading[activeUid].total})
              </div>
            )}
            <RemoteTerminal
              key={activeUid}
              ref={(handle) => {
                if (handle) {
                  termRefs.current.set(activeUid, handle);
                } else {
                  termRefs.current.delete(activeUid);
                }
              }}
              uid={activeUid}
              onData={(data) => handleData(activeUid, data)}
              onResize={(cols, rows) => handleResize(activeUid, cols, rows)}
            />
          </div>
        ) : (
          <div className="no-session">
            <p>No active terminal sessions</p>
            <p className="no-session-hint">Open a terminal in Hyper to get started</p>
          </div>
        )}
      </div>
    </div>
  );
}
