import React, {useRef, useEffect, useCallback, useMemo, useState} from 'react';

import {useViewport} from '../hooks/useViewport';
import {useWebSocket, sessionDataBus} from '../hooks/useWebSocket';
import type {SessionDataEvent} from '../hooks/useWebSocket';
import {useRemoteStore} from '../store/remote-store';
import type {TerminalSessionInfo, WindowInfo} from '../types';
import {isTerminalResponse} from '../utils/terminal-response-filter';

import {MobileActionBar} from './MobileActionBar';
import {RemoteTerminal} from './RemoteTerminal';
import type {RemoteTerminalHandle} from './RemoteTerminal';
import {StatusBar} from './StatusBar';

interface AppProps {
  token: string;
}

function getSessionTitle(session: TerminalSessionInfo): string {
  if (session.title) return session.title;
  const shell = session.shell ? session.shell.split('/').pop() : 'shell';
  return `${shell}${session.pid ? ` (${session.pid})` : ''}`;
}

export function App({token}: AppProps) {
  const {state, dispatch} = useRemoteStore();
  const {send} = useWebSocket(token);
  const viewport = useViewport();
  const termRefs = useRef<Map<string, RemoteTerminalHandle | null>>(new Map());
  const activeUid = state.activeSessionUid;
  const prevVisibleRef = useRef<string[]>([]);
  const [windowDropdownOpen, setWindowDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 通过 CSS 变量驱动容器高度，在键盘弹起时动态调整
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (viewport.keyboardVisible) {
      el.style.setProperty('--viewport-height', `${viewport.height}px`);
    } else {
      el.style.removeProperty('--viewport-height');
    }
  }, [viewport.height, viewport.keyboardVisible]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setWindowDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const activeSession = useMemo(() => state.sessions.find((s) => s.uid === activeUid), [state.sessions, activeUid]);
  const activeWindow = useMemo(
    () => state.windows.find((w) => w.uid === activeSession?.windowId),
    [state.windows, activeSession]
  );

  const tabs = useMemo(() => {
    if (!activeWindow) return [];
    return activeWindow.sessions
      .map((uid) => state.sessions.find((s) => s.uid === uid))
      .filter(Boolean) as typeof state.sessions;
  }, [activeWindow, state.sessions]);

  const visibleUids = useMemo(() => {
    return activeUid ? [activeUid] : [];
  }, [activeUid]);

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
      if (isTerminalResponse(data)) return;
      send({type: 'input', payload: {uid, data}});
    },
    [send]
  );

  const termSizeMapRef = useRef<Map<string, {cols: number; rows: number}>>(new Map());

  const handleResize = useCallback(
    (uid: string, cols: number, rows: number) => {
      termSizeMapRef.current.set(uid, {cols, rows});
      if (document.hasFocus()) {
        send({type: 'resize', payload: {uid, cols, rows}});
      }
    },
    [send]
  );

  useEffect(() => {
    const onFocus = () => {
      if (activeUid) {
        const size = termSizeMapRef.current.get(activeUid);
        if (size) {
          send({type: 'resize', payload: {uid: activeUid, ...size}});
        }
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [activeUid, send]);

  const handleTabSelect = useCallback(
    (uid: string) => {
      dispatch({type: 'SET_ACTIVE_SESSION', payload: uid});
    },
    [dispatch]
  );

  const handleCloseTab = useCallback(
    (uid: string) => {
      send({type: 'close_tab', payload: {uid}});
    },
    [send]
  );

  const handleCreateTab = useCallback(() => {
    if (activeWindow) {
      send({type: 'create_tab', payload: {windowId: activeWindow.uid}});
    } else if (state.windows.length > 0) {
      send({type: 'create_tab', payload: {windowId: state.windows[0].uid}});
    } else {
      send({type: 'create_window', payload: {}});
    }
  }, [send, activeWindow, state.windows]);

  const handleCreateWindow = useCallback(() => {
    send({type: 'create_window', payload: {}});
  }, [send]);

  const handleSendKey = useCallback(
    (key: string) => {
      if (activeUid) {
        send({type: 'input', payload: {uid: activeUid, data: key}});
      }
    },
    [activeUid, send]
  );

  const showTabs = tabs.length > 1;
  const singleTabTitle = tabs.length === 1 && activeSession ? getSessionTitle(activeSession) : null;
  const {historyLoading} = state;
  const containerClass = `hyper-remote${viewport.keyboardVisible ? ' hyper-remote--keyboard-visible' : ''}`;

  return (
    <div className={containerClass} ref={containerRef}>
      {/* Header */}
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
                const title = getSessionTitle(session);
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
                    <i
                      className="tab-icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCloseTab(session.uid);
                      }}
                    >
                      ✕
                    </i>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {/* No sessions: empty space */}
          {tabs.length === 0 && <div className="tabs-title">Hyper Remote</div>}

          {/* Right toolbar area */}
          <div className="header-toolbar">
            {/* New tab button - always visible */}
            <button className="header-toolbar-btn" title="New Tab" onClick={handleCreateTab}>
              +
            </button>

            {/* Window selector dropdown */}
            {state.windows.length > 1 && (
              <div
                className="header-toolbar-btn window-selector"
                ref={dropdownRef}
                onClick={() => setWindowDropdownOpen(!windowDropdownOpen)}
              >
                <span className="window-selector-icon">{state.windows.length}</span>
                <span className="window-selector-arrow">&#9662;</span>
                {windowDropdownOpen && (
                  <div className="window-dropdown">
                    {state.windows.map((win: WindowInfo, wi: number) => {
                      return (
                        <div key={win.uid} className="window-dropdown-group">
                          {wi > 0 && <div className="window-dropdown-separator" />}
                          <div className="window-dropdown-header">{win.title || `Window ${wi + 1}`}</div>
                          {win.sessions.map((sessionUid) => {
                            const session = state.sessions.find((s) => s.uid === sessionUid);
                            if (!session) return null;
                            const isCurrent = session.uid === activeUid;
                            return (
                              <button
                                key={sessionUid}
                                className={`window-dropdown-item ${isCurrent ? 'window-dropdown-item--current' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleTabSelect(sessionUid);
                                  setWindowDropdownOpen(false);
                                }}
                              >
                                <span>{getSessionTitle(session)}</span>
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
          </div>
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
            <div className="no-session-icon">&#9638;</div>
            <p>No active terminal sessions</p>
            <p className="no-session-hint">All terminals have been closed</p>
            <div className="no-session-actions">
              <button className="no-session-btn no-session-btn--primary" onClick={handleCreateTab}>
                New Tab
              </button>
              <button className="no-session-btn" onClick={handleCreateWindow}>
                New Window
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 移动端键盘弹起时显示的快捷操作栏 */}
      {viewport.isMobile && <MobileActionBar onSendKey={handleSendKey} />}

      {/* Bottom Status Bar */}
      <StatusBar />
    </div>
  );
}
