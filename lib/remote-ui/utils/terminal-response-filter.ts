/**
 * Filter for detecting xterm.js terminal query responses.
 *
 * In a multi-viewer scenario (Electron app + Web UI), the primary terminal
 * (Electron) should be the sole responder to terminal queries (DSR, DA, CPR, etc.).
 * The Web UI's xterm.js also generates these responses when it processes
 * forwarded terminal data. If these duplicate responses are sent back to the PTY,
 * the shell interprets them as garbled user input, causing mysterious characters
 * to appear in both the app and the web UI.
 *
 * This filter detects known response patterns so they can be suppressed.
 */

// CSI Cursor Position Report: \e[row;colR — response to \e[6n
const CPR_RE = /^\x1b\[\d+;\d+R$/;

// CSI Primary Device Attributes: \e[?...c — response to \e[c / \e[0c
const DA1_RE = /^\x1b\[\?[\d;]*c$/;

// CSI Secondary Device Attributes: \e[>...c — response to \e[>c
const DA2_RE = /^\x1b\[>[\d;]*c$/;

// CSI Device Status Report: \e[...n — response to \e[5n / \e[6n etc.
const DSR_RE = /^\x1b\[\d+n$/;

// CSI DECRPM (mode report): \e[?...;...$y — response to DECRQM
const DECRPM_RE = /^\x1b\[\?[\d;]*\$y$/;

// DCS responses (DA3, XTVERSION, etc.): \eP...ST
const DCS_RE = /^\x1bP[^\x1b]*\x1b\\$/;

// OSC responses (color queries, title, etc.): \e]N;...BEL or \e]N;...ST
const OSC_RE = /^\x1b\]\d+;[^\x07]*(?:\x07|\x1b\\)$/;

// Kitty keyboard protocol query response: \e[?...u
const KITTY_KBD_RE = /^\x1b\[\?\d+u$/;

const RESPONSE_PATTERNS = [CPR_RE, DA1_RE, DA2_RE, DSR_RE, DECRPM_RE, DCS_RE, OSC_RE, KITTY_KBD_RE];

export function isTerminalResponse(data: string): boolean {
  for (const pattern of RESPONSE_PATTERNS) {
    if (pattern.test(data)) return true;
  }
  return false;
}
