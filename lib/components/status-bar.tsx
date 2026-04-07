import React, {useState, useCallback} from 'react';

const electronShell = (
  window as typeof window & {
    require: (id: 'electron') => {
      clipboard: {writeText: (text: string) => void};
    };
  }
).require('electron');

const {clipboard} = electronShell;

export interface StatusBarProps {
  remoteLocalUrl: string | null;
  remoteLanUrl: string | null;
  borderColor: string;
}

type CopiedKey = 'local' | 'lan' | null;

const StatusBar = ({remoteLocalUrl, remoteLanUrl, borderColor}: StatusBarProps) => {
  const [copied, setCopied] = useState<CopiedKey>(null);

  const handleCopy = useCallback((url: string, key: CopiedKey) => {
    clipboard.writeText(url);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }, []);

  return (
    <footer className="statusbar">
      {/* 左侧区域 — 未来可扩展放置其他状态信息 */}
      <div className="statusbar_left" />

      {/* 右侧区域 — Remote URL 复制按钮 */}
      <div className="statusbar_right">
        {remoteLocalUrl && (
          <button className="statusbar_btn" onClick={() => handleCopy(remoteLocalUrl, 'local')} title={remoteLocalUrl}>
            {copied === 'local' ? '✓ Copied' : '⌘ Localhost'}
          </button>
        )}
        {remoteLanUrl && (
          <button className="statusbar_btn" onClick={() => handleCopy(remoteLanUrl, 'lan')} title={remoteLanUrl}>
            {copied === 'lan' ? '✓ Copied' : '⌘ LAN'}
          </button>
        )}
      </div>

      <style jsx>{`
        .statusbar {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 22px;
          background: black;
          border-top: 1px solid ${borderColor};
          padding: 0 4px;
          flex-shrink: 0;
          -webkit-app-region: no-drag;
          z-index: 100;
        }

        .statusbar_left {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
          min-width: 0;
        }

        .statusbar_right {
          display: flex;
          align-items: center;
          gap: 2px;
          flex-shrink: 0;
        }

        .statusbar_btn {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          height: 18px;
          padding: 0 8px;
          font-size: 11px;
          font-family: inherit;
          color: #ccc;
          background: transparent;
          border: none;
          border-radius: 3px;
          cursor: pointer;
          white-space: nowrap;
          line-height: 1;
          -webkit-app-region: no-drag;
        }

        .statusbar_btn:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
        }

        .statusbar_btn:active {
          background: rgba(255, 255, 255, 0.06);
        }
      `}</style>
    </footer>
  );
};

export default StatusBar;
