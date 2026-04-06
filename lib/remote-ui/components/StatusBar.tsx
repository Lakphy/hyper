import React from 'react';

import {useRemoteStore} from '../store/remote-store';
import type {ConnectionStatus} from '../types';

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connecting: '⟳ Connecting…',
  connected: '● Connected',
  disconnected: '○ Disconnected',
  error: '✕ Error'
};

const STATUS_CLASSES: Record<ConnectionStatus, string> = {
  connecting: 'status--connecting',
  connected: 'status--connected',
  disconnected: 'status--disconnected',
  error: 'status--error'
};

export function StatusBar() {
  const {state} = useRemoteStore();
  const {connectionStatus, sessions, lastError} = state;

  return (
    <div className="status-bar">
      <span className={`status-indicator ${STATUS_CLASSES[connectionStatus]}`}>{STATUS_LABELS[connectionStatus]}</span>
      <span className="status-sessions">
        {sessions.length} session{sessions.length !== 1 ? 's' : ''}
      </span>
      {lastError && <span className="status-error">{lastError}</span>}
    </div>
  );
}
