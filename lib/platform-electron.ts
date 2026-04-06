import {clipboard, shell} from 'electron';
import type {PlatformAPI} from './platform-context';
import terms from './terms';
import processClipboard from './utils/paste';
import {decorate} from './utils/plugins';

/**
 * Electron-specific platform implementation.
 * Used when term.tsx runs inside the Electron renderer process.
 */
export const electronPlatform: PlatformAPI = {
  clipboardWriteText(text: string) {
    clipboard.writeText(text);
  },

  openExternal(uri: string) {
    void shell.openExternal(uri);
  },

  processClipboard() {
    return processClipboard();
  },

  registerTerm(uid: string, term: any) {
    terms[uid] = term;
  },

  unregisterTerm(uid: string) {
    terms[uid] = null;
  },

  decorate<T>(Component: T, name: string): T {
    return decorate(Component as any, name) as T;
  },

  reportRenderer(uid: string, type: string) {
    window.rpc.emit('info renderer', {uid, type});
  },

  platform: process.platform
};
