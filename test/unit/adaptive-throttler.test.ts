import test from 'ava';

import {AdaptiveThrottler} from '../../app/remote/adaptive-throttler';

test('shouldSend returns "send" for small data', (t) => {
  const throttler = new AdaptiveThrottler();
  const result = throttler.shouldSend('uid-1', 1024); // 1KB
  t.is(result, 'send');
});

test('shouldSend returns "throttle" when exceeding 256KB/s', (t) => {
  const throttler = new AdaptiveThrottler();
  // Fill up to threshold
  throttler.shouldSend('uid-1', 256 * 1024); // exactly at threshold
  const result = throttler.shouldSend('uid-1', 1); // one more byte tips it
  t.is(result, 'throttle');
});

test('shouldSend returns "drop" when exceeding 1MB/s', (t) => {
  const throttler = new AdaptiveThrottler();
  throttler.shouldSend('uid-1', 1024 * 1024); // fill to hard limit
  const result = throttler.shouldSend('uid-1', 1); // one more byte
  t.is(result, 'drop');
});

test('shouldSend tracks sessions independently', (t) => {
  const throttler = new AdaptiveThrottler();
  throttler.shouldSend('uid-1', 300 * 1024); // uid-1 is throttled
  const result = throttler.shouldSend('uid-2', 1024); // uid-2 is fine
  t.is(result, 'send');
});

test('shouldSend resets window after 1 second', async (t) => {
  const throttler = new AdaptiveThrottler();
  throttler.shouldSend('uid-1', 300 * 1024); // throttled
  t.is(throttler.shouldSend('uid-1', 1), 'throttle');

  // Wait for window to expire
  await new Promise((resolve) => setTimeout(resolve, 1100));

  // New window, should be fresh
  t.is(throttler.shouldSend('uid-1', 1024), 'send');
});

test('summarize returns data as-is when 5 lines or fewer', (t) => {
  const throttler = new AdaptiveThrottler();
  const data = 'line1\nline2\nline3\nline4\nline5';
  t.is(throttler.summarize(data), data);
});

test('summarize truncates and keeps last 3 lines for large output', (t) => {
  const throttler = new AdaptiveThrottler();
  const lines = Array.from({length: 20}, (_, i) => `line${i + 1}`);
  const data = lines.join('\n');
  const result = throttler.summarize(data);

  // Should contain throttle notice
  t.true(result.includes('lines throttled'));
  // Should end with last 3 lines
  t.true(result.endsWith('line18\nline19\nline20'));
});

test('summarize includes correct line count in notice', (t) => {
  const throttler = new AdaptiveThrottler();
  const lines = Array.from({length: 10}, (_, i) => `line${i}`);
  const data = lines.join('\n');
  const result = throttler.summarize(data);
  // 10 lines total - 3 kept = 7 throttled
  t.true(result.includes('7 lines throttled'));
});

test('reset clears rate tracking for a session', (t) => {
  const throttler = new AdaptiveThrottler();
  throttler.shouldSend('uid-1', 300 * 1024); // throttled
  throttler.reset('uid-1');
  // After reset, should be fresh
  t.is(throttler.shouldSend('uid-1', 1024), 'send');
});

test('reset on non-existent uid is a no-op', (t) => {
  const throttler = new AdaptiveThrottler();
  throttler.reset('ghost');
  t.pass();
});

test('shouldSend accumulates within same window', (t) => {
  const throttler = new AdaptiveThrottler();
  // Send 128KB chunks — 256KB total is exactly at threshold (not over), so still 'send'
  t.is(throttler.shouldSend('uid-1', 128 * 1024), 'send');
  t.is(throttler.shouldSend('uid-1', 128 * 1024), 'send'); // exactly 256KB, not over
  // One more byte tips it over
  t.is(throttler.shouldSend('uid-1', 1), 'throttle');
});
