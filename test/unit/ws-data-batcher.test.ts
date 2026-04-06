import test from 'ava';

import {WSDataBatcher} from '../../app/remote/ws-data-batcher';

test('WSDataBatcher: flush sends single buffer directly', (t) => {
  const results: Buffer[] = [];
  const batcher = new WSDataBatcher((batch) => results.push(batch));

  const buf = Buffer.from('hello');
  batcher.write(buf);
  batcher.flush();

  t.is(results.length, 1);
  t.deepEqual(results[0], buf);
  batcher.destroy();
});

test('WSDataBatcher: flush concatenates multiple buffers', (t) => {
  const results: Buffer[] = [];
  const batcher = new WSDataBatcher((batch) => results.push(batch));

  batcher.write(Buffer.from('aaa'));
  batcher.write(Buffer.from('bbb'));
  batcher.flush();

  t.is(results.length, 1);
  t.is(results[0].toString(), 'aaabbb');
  batcher.destroy();
});

test('WSDataBatcher: flush on empty buffer is a no-op', (t) => {
  const results: Buffer[] = [];
  const batcher = new WSDataBatcher((batch) => results.push(batch));

  batcher.flush();
  t.is(results.length, 0);
  batcher.destroy();
});

test('WSDataBatcher: auto-flushes when exceeding max batch size', (t) => {
  const results: Buffer[] = [];
  const batcher = new WSDataBatcher((batch) => results.push(batch));

  // Write a buffer that exceeds 200KB
  const bigBuf = Buffer.alloc(201 * 1024, 0x41);
  batcher.write(bigBuf);

  // Should have flushed immediately
  t.is(results.length, 1);
  t.is(results[0].length, 201 * 1024);
  batcher.destroy();
});

test('WSDataBatcher: timer-based flush fires after interval', async (t) => {
  const results: Buffer[] = [];
  const batcher = new WSDataBatcher((batch) => results.push(batch));

  batcher.write(Buffer.from('delayed'));
  t.is(results.length, 0); // Not flushed yet

  // Wait for the 16ms timer
  await new Promise((resolve) => setTimeout(resolve, 50));

  t.is(results.length, 1);
  t.is(results[0].toString(), 'delayed');
  batcher.destroy();
});

test('WSDataBatcher: destroy clears pending data', async (t) => {
  const results: Buffer[] = [];
  const batcher = new WSDataBatcher((batch) => results.push(batch));

  batcher.write(Buffer.from('pending'));
  batcher.destroy();

  // Wait to ensure timer would have fired
  await new Promise((resolve) => setTimeout(resolve, 50));

  t.is(results.length, 0);
});

test('WSDataBatcher: multiple writes below threshold batch together', async (t) => {
  const results: Buffer[] = [];
  const batcher = new WSDataBatcher((batch) => results.push(batch));

  batcher.write(Buffer.from('a'));
  batcher.write(Buffer.from('b'));
  batcher.write(Buffer.from('c'));

  // Wait for timer flush
  await new Promise((resolve) => setTimeout(resolve, 50));

  t.is(results.length, 1);
  t.is(results[0].toString(), 'abc');
  batcher.destroy();
});
