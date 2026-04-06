import React from 'react';
import {useRemoteStore} from '../store/remote-store';
import type {WindowInfo} from '../types';

export function WindowList() {
  const {state, dispatch} = useRemoteStore();
  const {windows, sessions, activeSessionUid, collapsedWindows, historyLoading} = state;

  const handleSelect = (uid: string) => {
    dispatch({type: 'SET_ACTIVE_SESSION', payload: uid});
  };

  const toggleCollapse = (windowUid: string) => {
    dispatch({type: 'TOGGLE_WINDOW_COLLAPSED', payload: windowUid});
  };

  // Determine which window the active session belongs to
  const activeSession = sessions.find((s) => s.uid === activeSessionUid);
  const activeWindowUid = activeSession?.windowId ?? null;

  if (sessions.length === 0) {
    return (
      <div className="window-list">
        <div className="window-list-header">Sessions</div>
        <div className="window-list-empty">No active terminals</div>
      </div>
    );
  }

  return (
    <div className="window-list">
      <div className="window-list-header">Sessions</div>
      <div className="window-list-content">
        {windows.map((win: WindowInfo) => {
          const isCollapsed = !!collapsedWindows[win.uid];
          const isActiveWindow = win.uid === activeWindowUid;
          return (
            <div key={win.uid} className={`window-group ${isActiveWindow ? 'window-group--active' : ''}`}>
              <button className="window-header" onClick={() => toggleCollapse(win.uid)}>
                <span className="window-collapse-icon">{isCollapsed ? '▶' : '▼'}</span>
                <span className="window-title">{win.title || 'Window'}</span>
                <span className="window-session-count">{win.sessions.length}</span>
              </button>
              {!isCollapsed &&
                win.sessions.map((sessionUid, index) => {
                  const session = sessions.find((s) => s.uid === sessionUid);
                  if (!session) return null;
                  const isActive = sessionUid === activeSessionUid;
                  const isLoadingHistory = !!historyLoading[sessionUid];
                  return (
                    <button
                      key={sessionUid}
                      className={`session-item ${isActive ? 'session-item--active' : ''}`}
                      onClick={() => handleSelect(sessionUid)}
                      title={`PID: ${session.pid ?? 'N/A'}\nCWD: ${session.cwd ?? 'N/A'}`}
                    >
                      <span className="tab-index">{index + 1}</span>
                      <span className="session-shell">
                        {session.shell ? session.shell.split('/').pop() : 'shell'}
                      </span>
                      <span className="session-pid">{session.pid ?? ''}</span>
                      {isLoadingHistory && <span className="history-loading-dot" />}
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
