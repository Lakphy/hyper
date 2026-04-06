import React, {createContext, useContext} from 'react';

/**
 * Platform abstraction layer for term.tsx.
 * Allows the same terminal component to run in both Electron and browser environments.
 */

export interface PlatformAPI {
  /** Write text to clipboard */
  clipboardWriteText(text: string): void;
  /** Open a URL externally */
  openExternal(uri: string): void;
  /** Process clipboard for paste (returns path string or null) */
  processClipboard(): string | null;
  /** Register a term instance for imperative access */
  registerTerm(uid: string, term: any): void;
  /** Unregister a term instance */
  unregisterTerm(uid: string): void;
  /** Decorate a component (plugin system) */
  decorate<T>(Component: T, name: string): T;
  /** Report renderer type to main process */
  reportRenderer(uid: string, type: string): void;
  /** Current platform string */
  platform: string;
}

const PlatformContext = createContext<PlatformAPI | null>(null);

export function PlatformProvider({value, children}: {value: PlatformAPI; children: React.ReactNode}) {
  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformAPI {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error('usePlatform must be used within PlatformProvider');
  return ctx;
}

/** For class components that can't use hooks */
export {PlatformContext};
