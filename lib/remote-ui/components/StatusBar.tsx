import React, {useState, useCallback} from 'react';

import {useRemoteStore} from '../store/remote-store';
import type {ConnectionStatus} from '../types';

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connecting: '⟳ Connecting…',
  connected: '● Connected',
  disconnected: '○ Disconnected',
  error: '✕ Error'
};

type CopiedKey = 'local' | 'lan' | null;

function getRemoteUrls() {
  const proto = window.location.protocol;
  const port = window.location.port;
  const token = new URLSearchParams(window.location.search).get('token');
  const qs = token ? `?token=${token}` : '';
  return {
    local: `${proto}//localhost:${port}${qs}`,
    lan: `${proto}//${window.location.hostname}:${port}${qs}`
  };
}

export function StatusBar() {
  const {state} = useRemoteStore();
  const {connectionStatus, sessions, clientCount} = state;
  const [copied, setCopied] = useState<CopiedKey>(null);

  const handleCopy = useCallback((url: string, key: CopiedKey) => {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  }, []);

  const urls = getRemoteUrls();
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  return (
    <div className="statusbar">
      <div className="statusbar-left">
        <span className={`statusbar-connection statusbar-connection--${connectionStatus}`}>
          {STATUS_LABELS[connectionStatus]}
        </span>
        <span className="statusbar-sessions">
          {sessions.length} session{sessions.length !== 1 ? 's' : ''}
        </span>
        {clientCount > 1 && (
          <span className="statusbar-clients" title={`${clientCount} WebUI clients connected`}>
            👥 {clientCount}
          </span>
        )}
      </div>
      <div className="statusbar-right">
        <button className="statusbar-btn" onClick={() => handleCopy(urls.local, 'local')} title={urls.local}>
          {copied === 'local' ? '✓ Copied' : '⌘ Localhost'}
        </button>
        {!isLocalhost && (
          <button className="statusbar-btn" onClick={() => handleCopy(urls.lan, 'lan')} title={urls.lan}>
            {copied === 'lan' ? '✓ Copied' : '⌘ LAN'}
          </button>
        )}
      </div>
    </div>
  );
}
