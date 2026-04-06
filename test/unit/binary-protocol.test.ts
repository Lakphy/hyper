import test from 'ava';

import {encodeSessionData, decodeSessionData, isBinaryMessage} from '../../app/remote/binary-protocol';

const SAMPLE_UID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

test('encode/decode roundtrip preserves uid and data', (t) => {
  const data = 'hello world\r\n';
  const encoded = encodeSessionData(SAMPLE_UID, data);
  const decoded = decodeSessionData(encoded);
  t.is(decoded.uid, SAMPLE_UID);
  t.is(decoded.data, data);
});

test('encode produces correct header size', (t) => {
  const encoded = encodeSessionData(SAMPLE_UID, 'test');
  // Header: 1 (type) + 36 (uid) + 4 (length) = 41 bytes
  // Data: 4 bytes ('test' in utf8)
  t.is(encoded.length, 41 + 4);
});

test('encode writes correct type byte', (t) => {
  const encoded = encodeSessionData(SAMPLE_UID, 'x');
  t.is(encoded.readUInt8(0), 0x01);
});

test('encode writes correct data length', (t) => {
  const data = 'hello';
  const encoded = encodeSessionData(SAMPLE_UID, data);
  t.is(encoded.readUInt32LE(37), Buffer.byteLength(data, 'utf8'));
});

test('encode/decode handles empty data', (t) => {
  const encoded = encodeSessionData(SAMPLE_UID, '');
  const decoded = decodeSessionData(encoded);
  t.is(decoded.uid, SAMPLE_UID);
  t.is(decoded.data, '');
  t.is(encoded.length, 41); // header only
});

test('encode/decode handles unicode data', (t) => {
  const data = '你好世界 🌍 émojis';
  const encoded = encodeSessionData(SAMPLE_UID, data);
  const decoded = decodeSessionData(encoded);
  t.is(decoded.data, data);
});

test('encode/decode handles ANSI escape sequences', (t) => {
  const data = '\x1b[31mred text\x1b[0m\r\n\x1b[1mbold\x1b[0m';
  const encoded = encodeSessionData(SAMPLE_UID, data);
  const decoded = decodeSessionData(encoded);
  t.is(decoded.data, data);
});

test('encode/decode handles short uid (padded)', (t) => {
  const shortUid = 'short-uid';
  const encoded = encodeSessionData(shortUid, 'data');
  const decoded = decodeSessionData(encoded);
  t.is(decoded.uid, shortUid);
});

test('isBinaryMessage returns true for encoded messages', (t) => {
  const encoded = encodeSessionData(SAMPLE_UID, 'test');
  t.true(isBinaryMessage(encoded));
});

test('isBinaryMessage returns false for strings', (t) => {
  t.false(isBinaryMessage('not binary'));
});

test('isBinaryMessage returns false for empty buffer', (t) => {
  t.false(isBinaryMessage(Buffer.alloc(0)));
});

test('isBinaryMessage returns false for non-session-data buffer', (t) => {
  const buf = Buffer.alloc(10);
  buf.writeUInt8(0x99, 0); // wrong type byte
  t.false(isBinaryMessage(buf));
});

test('encode/decode handles large data', (t) => {
  const data = 'x'.repeat(100_000);
  const encoded = encodeSessionData(SAMPLE_UID, data);
  const decoded = decodeSessionData(encoded);
  t.is(decoded.data.length, 100_000);
  t.is(decoded.uid, SAMPLE_UID);
});
