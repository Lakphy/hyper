import React, {useCallback, useRef, useImperativeHandle, forwardRef, useMemo, useEffect} from 'react';

import type {Immutable} from 'seamless-immutable';

import Term from '../../components/term';

export interface RemoteTerminalHandle {
  write(data: string): void;
  clear(): void;
  focus(): void;
}

interface RemoteTerminalProps {
  uid: string;
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
}

function isMobileDevice(): boolean {
  return (
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || ('ontouchstart' in window && window.innerWidth <= 600)
  );
}

function getMobileFontSize(): number {
  const w = window.innerWidth;
  if (w >= 600) return 13;
  if (w >= 414) return 12;
  if (w >= 375) return 11;
  return 10;
}

const defaultColors = {
  black: '#000000',
  red: '#C51E14',
  green: '#1DC121',
  yellow: '#C7C329',
  blue: '#0A2FC4',
  magenta: '#C839C5',
  cyan: '#20C5C6',
  white: '#C7C7C7',
  lightBlack: '#686868',
  lightRed: '#FD6F6B',
  lightGreen: '#67F86F',
  lightYellow: '#FFFA72',
  lightBlue: '#6A76FB',
  lightMagenta: '#FD7CFC',
  lightCyan: '#68FDFE',
  lightWhite: '#FFFFFF'
};

const noop = () => {};

export const RemoteTerminal = forwardRef<RemoteTerminalHandle, RemoteTerminalProps>(({uid, onData, onResize}, ref) => {
  const termInstanceRef = useRef<Term | null>(null);
  const mobile = useMemo(() => isMobileDevice(), []);

  const ref_ = useCallback((termUid: string, instance: Term | null) => {
    termInstanceRef.current = instance;
  }, []);

  // 挂载后在 xterm textarea 上设置属性，尽量降低 iOS AutoFill 栏出现的概率
  useEffect(() => {
    const term = termInstanceRef.current;
    if (!term) return;
    const textarea = (term as any).term?.textarea as HTMLTextAreaElement | undefined;
    if (!textarea) return;

    textarea.setAttribute('autocomplete', 'off');
    textarea.setAttribute('autocorrect', 'off');
    textarea.setAttribute('autocapitalize', 'off');
    textarea.setAttribute('spellcheck', 'false');
    textarea.setAttribute('data-form-type', 'other');
    textarea.setAttribute('data-lpignore', 'true');
    textarea.setAttribute('data-1p-ignore', 'true');
    textarea.setAttribute('name', `xterm-${uid}`);
    textarea.setAttribute('enterkeyhint', 'send');
  });

  useImperativeHandle(ref, () => ({
    write(data: string) {
      termInstanceRef.current?.write(data);
    },
    clear() {
      termInstanceRef.current?.clear();
    },
    focus() {
      termInstanceRef.current?.focus();
    }
  }));

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      onResize?.(cols, rows);
    },
    [onResize]
  );

  const handleData = useCallback(
    (data: string) => {
      onData?.(data);
    },
    [onData]
  );

  const fontSize = mobile ? getMobileFontSize() : 13;
  const padding = mobile ? '4px 4px' : '12px 14px';

  return (
    <Term
      uid={uid}
      ref_={ref_}
      term={null}
      fitAddon={null}
      searchAddon={null}
      isTermActive={true}
      cols={null}
      rows={null}
      customChildren={undefined}
      customChildrenBefore={undefined}
      backgroundColor="#000000"
      foregroundColor="#ffffff"
      borderColor="#333"
      cursorColor="rgba(248,28,229,0.8)"
      cursorAccentColor="#000000"
      selectionColor="rgba(248,28,229,0.3)"
      colors={defaultColors as any}
      cursorShape="BLOCK"
      cursorBlink={true}
      fontFamily='Menlo, "DejaVu Sans Mono", Consolas, "Lucida Console", monospace'
      fontSize={fontSize}
      fontWeight="normal"
      fontWeightBold="bold"
      lineHeight={1}
      letterSpacing={0}
      padding={padding}
      scrollback={5000}
      modifierKeys={{altIsMeta: false, cmdIsMeta: false} as Immutable<{altIsMeta: boolean; cmdIsMeta: boolean}>}
      bell={false}
      bellSound={null}
      bellSoundURL={null}
      copyOnSelect={false}
      quickEdit={false}
      macOptionSelectionMode=""
      disableLigatures={false}
      webGLRenderer={false}
      webLinksActivationKey=""
      screenReaderMode={false}
      imageSupport={false}
      uiFontFamily="system-ui, sans-serif"
      search={false}
      cleared={false}
      onData={handleData}
      onResize={handleResize}
      onTitle={noop}
      onActive={noop}
      onOpenSearch={noop}
      onCloseSearch={noop}
      onContextMenu={noop}
      windowsPty={undefined}
    />
  );
});

RemoteTerminal.displayName = 'RemoteTerminal';
