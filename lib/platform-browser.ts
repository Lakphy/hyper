import type {PlatformAPI} from './platform-context';

/**
 * Browser-specific platform implementation.
 * Used when term.tsx runs in the remote Web UI (no Electron).
 */
export const browserPlatform: PlatformAPI = {
  clipboardWriteText(text: string) {
    void navigator.clipboard.writeText(text);
  },

  openExternal(uri: string) {
    window.open(uri, '_blank');
  },

  processClipboard() {
    // Browser doesn't support the Electron-specific file path clipboard processing
    return null;
  },

  registerTerm(_uid: string, _term: any) {
    // No-op in browser — no imperative term registry needed
  },

  unregisterTerm(_uid: string) {
    // No-op in browser
  },

  decorate<T>(Component: T, _name: string): T {
    // No plugin system in browser — return component as-is
    return Component;
  },

  reportRenderer(_uid: string, _type: string) {
    // No-op in browser — no main process to report to
  },

  platform: navigator.platform?.includes('Win') ? 'win32' : navigator.platform?.includes('Mac') ? 'darwin' : 'linux'
};
