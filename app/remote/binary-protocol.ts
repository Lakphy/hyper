/**
 * Binary protocol for high-frequency session_data messages
 *
 * Message format:
 * ┌──────────┬──────────────────┬──────────────┬────────────┐
 * │ type (1B)│ uid (36B, ASCII) │ length (4B)  │ data (NB)  │
 * └──────────┴──────────────────┴──────────────┴────────────┘
 */

const MSG_TYPE_SESSION_DATA = 0x01;

export function encodeSessionData(uid: string, data: string): Buffer {
  const dataBuffer = Buffer.from(data, 'utf8');
  const header = Buffer.allocUnsafe(41); // 1 + 36 + 4
  header.writeUInt8(MSG_TYPE_SESSION_DATA, 0);
  header.write(uid.padEnd(36, ' '), 1, 36, 'ascii');
  header.writeUInt32LE(dataBuffer.length, 37);
  return Buffer.concat([header, dataBuffer]);
}

export function decodeSessionData(buffer: Buffer): {uid: string; data: string} {
  const uid = buffer.toString('ascii', 1, 37).trimEnd();
  const length = buffer.readUInt32LE(37);
  const data = buffer.toString('utf8', 41, 41 + length);
  return {uid, data};
}

export function isBinaryMessage(data: Buffer | string): boolean {
  return Buffer.isBuffer(data) && data.length > 0 && data.readUInt8(0) === MSG_TYPE_SESSION_DATA;
}
