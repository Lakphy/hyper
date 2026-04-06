/**
 * Browser-compatible binary protocol decoder for session_data messages.
 * Matches the format from app/remote/binary-protocol.ts but uses
 * DataView/TextDecoder instead of Node Buffer.
 *
 * Format per message:
 * ┌──────────┬──────────────────┬──────────────┬────────────┐
 * │ type (1B)│ uid (36B, ASCII) │ length (4B)  │ data (NB)  │
 * └──────────┴──────────────────┴──────────────┴────────────┘
 */

const MSG_TYPE_SESSION_DATA = 0x01;
const HEADER_SIZE = 41; // 1 + 36 + 4

export interface DecodedSessionData {
  uid: string;
  data: string;
}

const asciiDecoder = new TextDecoder('ascii');
const utf8Decoder = new TextDecoder('utf-8');

/**
 * Decode one or more binary session_data messages from an ArrayBuffer.
 * The WSDataBatcher may concatenate multiple messages into a single frame.
 */
export function decodeBinaryMessages(buffer: ArrayBuffer): DecodedSessionData[] {
  const results: DecodedSessionData[] = [];
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;

  while (offset + HEADER_SIZE <= buffer.byteLength) {
    const type = view.getUint8(offset);
    if (type !== MSG_TYPE_SESSION_DATA) break;

    const uidBytes = bytes.subarray(offset + 1, offset + 37);
    const uid = asciiDecoder.decode(uidBytes).trimEnd();

    const dataLength = view.getUint32(offset + 37, true); // little-endian
    const dataStart = offset + HEADER_SIZE;
    const dataEnd = dataStart + dataLength;

    if (dataEnd > buffer.byteLength) break;

    const data = utf8Decoder.decode(bytes.subarray(dataStart, dataEnd));
    results.push({uid, data});

    offset = dataEnd;
  }

  return results;
}

/** Check if an ArrayBuffer looks like a binary session_data message */
export function isBinarySessionData(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < HEADER_SIZE) return false;
  return new DataView(buffer).getUint8(0) === MSG_TYPE_SESSION_DATA;
}
