import test from 'ava';

import {SubscriptionManager} from '../../app/remote/subscription-manager';

test('subscribe adds sessions for a client', (t) => {
  const mgr = new SubscriptionManager();
  mgr.subscribe('client-1', ['session-a', 'session-b']);

  t.deepEqual(mgr.getClientSubscriptions('client-1').sort(), ['session-a', 'session-b']);
});

test('subscribe is additive', (t) => {
  const mgr = new SubscriptionManager();
  mgr.subscribe('client-1', ['session-a']);
  mgr.subscribe('client-1', ['session-b']);

  t.deepEqual(mgr.getClientSubscriptions('client-1').sort(), ['session-a', 'session-b']);
});

test('subscribe deduplicates', (t) => {
  const mgr = new SubscriptionManager();
  mgr.subscribe('client-1', ['session-a', 'session-a']);

  t.is(mgr.getClientSubscriptions('client-1').length, 1);
});

test('unsubscribe removes specific sessions', (t) => {
  const mgr = new SubscriptionManager();
  mgr.subscribe('client-1', ['session-a', 'session-b', 'session-c']);
  mgr.unsubscribe('client-1', ['session-b']);

  t.deepEqual(mgr.getClientSubscriptions('client-1').sort(), ['session-a', 'session-c']);
});

test('unsubscribe on non-existent client is a no-op', (t) => {
  const mgr = new SubscriptionManager();
  mgr.unsubscribe('ghost', ['session-a']);
  t.deepEqual(mgr.getClientSubscriptions('ghost'), []);
});

test('unsubscribe on non-existent session is a no-op', (t) => {
  const mgr = new SubscriptionManager();
  mgr.subscribe('client-1', ['session-a']);
  mgr.unsubscribe('client-1', ['session-z']);
  t.deepEqual(mgr.getClientSubscriptions('client-1'), ['session-a']);
});

test('getSubscribers returns all clients subscribed to a session', (t) => {
  const mgr = new SubscriptionManager();
  mgr.subscribe('client-1', ['session-a']);
  mgr.subscribe('client-2', ['session-a', 'session-b']);
  mgr.subscribe('client-3', ['session-b']);

  t.deepEqual(mgr.getSubscribers('session-a').sort(), ['client-1', 'client-2']);
  t.deepEqual(mgr.getSubscribers('session-b').sort(), ['client-2', 'client-3']);
});

test('getSubscribers returns empty for unsubscribed session', (t) => {
  const mgr = new SubscriptionManager();
  t.deepEqual(mgr.getSubscribers('session-x'), []);
});

test('removeClient clears all subscriptions for that client', (t) => {
  const mgr = new SubscriptionManager();
  mgr.subscribe('client-1', ['session-a', 'session-b']);
  mgr.subscribe('client-2', ['session-a']);

  mgr.removeClient('client-1');

  t.deepEqual(mgr.getClientSubscriptions('client-1'), []);
  t.deepEqual(mgr.getSubscribers('session-a'), ['client-2']);
  t.deepEqual(mgr.getSubscribers('session-b'), []);
});

test('removeClient on non-existent client is a no-op', (t) => {
  const mgr = new SubscriptionManager();
  mgr.removeClient('ghost');
  t.pass();
});

test('getClientSubscriptions returns empty for unknown client', (t) => {
  const mgr = new SubscriptionManager();
  t.deepEqual(mgr.getClientSubscriptions('unknown'), []);
});

test('multiple clients with overlapping subscriptions', (t) => {
  const mgr = new SubscriptionManager();
  mgr.subscribe('c1', ['s1', 's2']);
  mgr.subscribe('c2', ['s2', 's3']);
  mgr.subscribe('c3', ['s1', 's3']);

  t.deepEqual(mgr.getSubscribers('s1').sort(), ['c1', 'c3']);
  t.deepEqual(mgr.getSubscribers('s2').sort(), ['c1', 'c2']);
  t.deepEqual(mgr.getSubscribers('s3').sort(), ['c2', 'c3']);
});
