import test from 'ava';

/**
 * Browser binary protocol decoder tests.
 * Since AVA runs in Node, we polyfill the browser APIs (TextDecoder, DataView)
 * which are available in Node 16+ globally.
 */

// We can't import the browser module directly because it uses browser globals.
// Instead, we test the logic by reimplementing the same decode with Node Buffer
// and verifying compatibility with the server-side encoder.

import {encodeSessionData} from '../../app/remote/binary-protocol';

// Inline the browser decode logic for testing (same algorithm, using Node APIs to simulate browser)
function decodeBinaryMessages(buffer: ArrayBuffer): Array<{uid: string; data: string}> {
  const results: Array<{uid: string; data: string}> = [];
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;

  const HEADER_SIZE = 41;
  const MSG_TYPE_SESSION_DATA = 0x01;

  while (offset + HEADER_SIZE <= buffer.byteLength) {
    const type = view.getUint8(offset);
    if (type !== MSG_TYPE_SESSION_DATA) break;

    const uidBytes = bytes.subarray(offset + 1, offset + 37);
    const uid = new TextDecoder('ascii').decode(uidBytes).trimEnd();

    const dataLength = view.getUint32(offset + 37, true);
    const dataStart = offset + HEADER_SIZE;
    const dataEnd = dataStart + dataLength;

    if (dataEnd > buffer.byteLength) break;

    const data = new TextDecoder('utf-8').decode(bytes.subarray(dataStart, dataEnd));
    results.push({uid, data});

    offset = dataEnd;
  }

  return results;
}

function isBinarySessionData(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 41) return false;
  return new DataView(buffer).getUint8(0) === 0x01;
}

const SAMPLE_UID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

test('decode single message from server encoder', (t) => {
  const encoded = encodeSessionData(SAMPLE_UID, 'hello world');
  // Convert Node Buffer to ArrayBuffer
  const ab = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
  const messages = decodeBinaryMessages(ab);

  t.is(messages.length, 1);
  t.is(messages[0].uid, SAMPLE_UID);
  t.is(messages[0].data, 'hello world');
});

test('decode multiple concatenated messages', (t) => {
  const msg1 = encodeSessionData('uid-1-padded-to-fill-36-chars------', 'first');
  const msg2 = encodeSessionData('uid-2-padded-to-fill-36-chars------', 'second');
  const combined = Buffer.concat([msg1, msg2]);
  const ab = combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength);

  const messages = decodeBinaryMessages(ab);
  t.is(messages.length, 2);
  t.is(messages[0].data, 'first');
  t.is(messages[1].data, 'second');
});

test('decode handles empty data', (t) => {
  const encoded = encodeSessionData(SAMPLE_UID, '');
  const ab = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
  const messages = decodeBinaryMessages(ab);

  t.is(messages.length, 1);
  t.is(messages[0].uid, SAMPLE_UID);
  t.is(messages[0].data, '');
});

test('decode handles unicode data', (t) => {
  const data = '你好世界 🌍 émojis';
  const encoded = encodeSessionData(SAMPLE_UID, data);
  const ab = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
  const messages = decodeBinaryMessages(ab);

  t.is(messages.length, 1);
  t.is(messages[0].data, data);
});

test('decode handles ANSI escape sequences', (t) => {
  const data = '\x1b[31mred\x1b[0m \x1b[1mbold\x1b[0m';
  const encoded = encodeSessionData(SAMPLE_UID, data);
  const ab = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
  const messages = decodeBinaryMessages(ab);

  t.is(messages[0].data, data);
});

test('decode returns empty array for empty buffer', (t) => {
  const ab = new ArrayBuffer(0);
  t.deepEqual(decodeBinaryMessages(ab), []);
});

test('decode returns empty array for buffer too small for header', (t) => {
  const ab = new ArrayBuffer(10);
  t.deepEqual(decodeBinaryMessages(ab), []);
});

test('decode stops on invalid type byte', (t) => {
  const encoded = encodeSessionData(SAMPLE_UID, 'test');
  const buf = Buffer.from(encoded);
  buf.writeUInt8(0x99, 0); // corrupt type byte
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

  t.deepEqual(decodeBinaryMessages(ab), []);
});

test('decode stops on truncated data', (t) => {
  const encoded = encodeSessionData(SAMPLE_UID, 'hello world');
  // Truncate the buffer so data is incomplete
  const truncated = encoded.subarray(0, 45); // header (41) + only 4 of 11 data bytes
  const ab = truncated.buffer.slice(truncated.byteOffset, truncated.byteOffset + truncated.byteLength);

  t.deepEqual(decodeBinaryMessages(ab), []);
});

test('isBinarySessionData returns true for valid message', (t) => {
  const encoded = encodeSessionData(SAMPLE_UID, 'test');
  const ab = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
  t.true(isBinarySessionData(ab));
});

test('isBinarySessionData returns false for small buffer', (t) => {
  t.false(isBinarySessionData(new ArrayBuffer(5)));
});

test('isBinarySessionData returns false for wrong type', (t) => {
  const ab = new ArrayBuffer(50);
  new DataView(ab).setUint8(0, 0xff);
  t.false(isBinarySessionData(ab));
});

test('decode handles short uid (padded by encoder)', (t) => {
  const shortUid = 'short';
  const encoded = encodeSessionData(shortUid, 'data');
  const ab = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
  const messages = decodeBinaryMessages(ab);

  t.is(messages[0].uid, shortUid);
});

test('decode large data payload', (t) => {
  const data = 'x'.repeat(100_000);
  const encoded = encodeSessionData(SAMPLE_UID, data);
  const ab = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
  const messages = decodeBinaryMessages(ab);

  t.is(messages[0].data.length, 100_000);
});
