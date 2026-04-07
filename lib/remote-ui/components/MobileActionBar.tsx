import React, {useCallback} from 'react';

interface MobileActionBarProps {
  onSendKey: (key: string) => void;
}

const QUICK_KEYS = [
  {label: 'Tab', key: '\t'},
  {label: 'Esc', key: '\x1b', special: true},
  {label: '↑', key: '\x1b[A'},
  {label: '↓', key: '\x1b[B'},
  {label: '←', key: '\x1b[D'},
  {label: '→', key: '\x1b[C'},
  {label: 'Ctrl+C', key: '\x03', special: true},
  {label: 'Ctrl+D', key: '\x04', special: true},
  {label: 'Ctrl+Z', key: '\x1a', special: true},
  {label: 'Ctrl+L', key: '\x0c'},
  {label: 'Ctrl+A', key: '\x01'},
  {label: 'Ctrl+E', key: '\x05'},
  {label: 'Ctrl+R', key: '\x12'},
  {label: 'Ctrl+W', key: '\x17'},
  {label: '|', key: '|'},
  {label: '&', key: '&'},
  {label: '~', key: '~'},
  {label: '/', key: '/'}
];

export function MobileActionBar({onSendKey}: MobileActionBarProps) {
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      const key = e.currentTarget.dataset.key;
      if (key) onSendKey(key);
    },
    [onSendKey]
  );

  return (
    <div className="mobile-action-bar">
      {QUICK_KEYS.map((item) => (
        <button
          key={item.label}
          className={`mobile-action-btn${item.special ? ' mobile-action-btn--special' : ''}`}
          data-key={item.key}
          onMouseDown={handleClick}
          onTouchStart={(e) => {
            e.preventDefault();
            onSendKey(item.key);
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
