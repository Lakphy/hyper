import React from 'react';
import {useRemoteStore} from '../store/remote-store';
import type {WindowInfo} from '../types';

export function WindowList() {
  const {state, dispatch} = useRemoteStore();
  const {windows, sessions, activeSessionUid} = state;

  const handleSelect = (uid: string) => {
    dispatch({type: 'SET_ACTIVE_SESSION', payload: uid});
  };

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
        {windows.map((win: WindowInfo) => (
          <div key={win.uid} className="window-group">
            <div className="window-title">{win.title || `Window`}</div>
            {win.sessions.map((sessionUid) => {
              const session = sessions.find((s) => s.uid === sessionUid);
              if (!session) return null;
              const isActive = sessionUid === activeSessionUid;
              return (
                <button
                  key={sessionUid}
                  className={`session-item ${isActive ? 'session-item--active' : ''}`}
                  onClick={() => handleSelect(sessionUid)}
                  title={`PID: ${session.pid ?? 'N/A'}\nCWD: ${session.cwd ?? 'N/A'}`}
                >
                  <span className="session-shell">{session.shell ? session.shell.split('/').pop() : 'shell'}</span>
                  <span className="session-pid">{session.pid ?? ''}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
