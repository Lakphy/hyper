import React from 'react';
import {RemoteTerminal} from './RemoteTerminal';
import type {RemoteTerminalHandle} from './RemoteTerminal';
import {useRemoteStore} from '../store/remote-store';

interface TerminalGridProps {
  visibleUids: string[];
  activeUid: string | null;
  termRefs: React.MutableRefObject<Map<string, RemoteTerminalHandle | null>>;
  onData: (uid: string, data: string) => void;
  onResize: (uid: string, cols: number, rows: number) => void;
}

export function TerminalGrid({visibleUids, activeUid, termRefs, onData, onResize}: TerminalGridProps) {
  const {state, dispatch} = useRemoteStore();
  const {layoutMode, historyLoading} = state;

  return (
    <div className="terminal-grid-wrapper">
      <div className="terminal-grid-toolbar">
        <div className="layout-toggle">
          <button
            className={layoutMode === 'tabs' ? 'active' : ''}
            onClick={() => dispatch({type: 'SET_LAYOUT_MODE', payload: 'tabs'})}
            title="Tab layout"
          >
            Tabs
          </button>
          <button
            className={layoutMode === 'grid' ? 'active' : ''}
            onClick={() => dispatch({type: 'SET_LAYOUT_MODE', payload: 'grid'})}
            title="Grid layout"
          >
            Grid
          </button>
        </div>
      </div>

      <div className={layoutMode === 'grid' ? 'terminal-grid-container' : 'terminal-tabs-container'}>
        {visibleUids.map((uid) => (
          <div
            key={uid}
            className={`terminal-grid-item ${uid === activeUid ? 'terminal-grid-item-active' : ''}`}
            onClick={() => dispatch({type: 'SET_ACTIVE_SESSION', payload: uid})}
          >
            {historyLoading[uid] && (
              <div className="history-loading">
                Loading history ({historyLoading[uid].received}/{historyLoading[uid].total})
              </div>
            )}
            <RemoteTerminal
              ref={(handle) => {
                if (handle) {
                  termRefs.current.set(uid, handle);
                } else {
                  termRefs.current.delete(uid);
                }
              }}
              uid={uid}
              onData={(data) => onData(uid, data)}
              onResize={(cols, rows) => onResize(uid, cols, rows)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
