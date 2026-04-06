import test from 'ava';

import {CircularBuffer} from '../../app/remote/circular-buffer';

test('CircularBuffer: default capacity is 2MB', (t) => {
  const buf = new CircularBuffer();
  // Should accept up to 2MB without discarding
  const chunk = 'x'.repeat(1024 * 1024); // 1MB
  buf.append(chunk);
  buf.append(chunk);
  t.is(buf.getSize(), 2 * 1024 * 1024);
  t.is(buf.getAll().length, 2 * 1024 * 1024);
});

test('CircularBuffer: custom capacity', (t) => {
  const buf = new CircularBuffer(100);
  buf.append('a'.repeat(50));
  buf.append('b'.repeat(50));
  t.is(buf.getSize(), 100);
  buf.append('c'.repeat(10));
  // Should have discarded oldest chunk(s) to stay within 100
  t.true(buf.getSize() <= 100);
});

test('CircularBuffer: discards oldest chunks when exceeding limit', (t) => {
  const buf = new CircularBuffer(20);
  buf.append('aaaaaaaaaa'); // 10 chars
  buf.append('bbbbbbbbbb'); // 10 chars -> total 20, at limit
  buf.append('cccccccccc'); // 10 chars -> should discard 'aaa...'
  t.is(buf.getSize(), 20);
  t.false(buf.getAll().includes('a'));
  t.true(buf.getAll().includes('b'));
  t.true(buf.getAll().includes('c'));
});

test('CircularBuffer: getAll joins all chunks', (t) => {
  const buf = new CircularBuffer(1000);
  buf.append('hello');
  buf.append(' ');
  buf.append('world');
  t.is(buf.getAll(), 'hello world');
});

test('CircularBuffer: getSize tracks total size', (t) => {
  const buf = new CircularBuffer(1000);
  t.is(buf.getSize(), 0);
  buf.append('abc');
  t.is(buf.getSize(), 3);
  buf.append('de');
  t.is(buf.getSize(), 5);
});

test('CircularBuffer: clear resets buffer', (t) => {
  const buf = new CircularBuffer(1000);
  buf.append('data');
  buf.clear();
  t.is(buf.getSize(), 0);
  t.is(buf.getAll(), '');
});

test('CircularBuffer: resize shrinks and keeps tail data', (t) => {
  const buf = new CircularBuffer(100);
  buf.append('abcdefghij'); // 10
  buf.append('klmnopqrst'); // 10
  buf.append('uvwxyz1234'); // 10 -> total 30
  buf.resize(15);
  const result = buf.getAll();
  t.true(result.length <= 15);
  // Should keep the tail
  t.true(result.endsWith('1234'));
});

test('CircularBuffer: resize to larger size is a no-op when under limit', (t) => {
  const buf = new CircularBuffer(50);
  buf.append('hello');
  buf.resize(100);
  t.is(buf.getAll(), 'hello');
  t.is(buf.getSize(), 5);
});

test('CircularBuffer: handles empty buffer operations', (t) => {
  const buf = new CircularBuffer(100);
  t.is(buf.getAll(), '');
  t.is(buf.getSize(), 0);
  buf.clear();
  t.is(buf.getAll(), '');
  buf.resize(10);
  t.is(buf.getAll(), '');
});

test('CircularBuffer: single chunk exceeding limit is kept', (t) => {
  const buf = new CircularBuffer(5);
  buf.append('abcdefghij'); // 10 chars, exceeds limit but it's the only chunk
  // The while loop condition requires chunks.length > 1, so single chunk is kept
  t.is(buf.getSize(), 10);
  t.is(buf.getAll(), 'abcdefghij');
});
