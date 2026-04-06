/**
 * SubscriptionManager - Manages which clients subscribe to which terminal sessions
 * Enables selective broadcasting to reduce unnecessary data transmission
 */
export class SubscriptionManager {
  // clientId -> subscribed session uid set
  private subscriptions = new Map<string, Set<string>>();

  subscribe(clientId: string, sessionUids: string[]) {
    let subs = this.subscriptions.get(clientId);
    if (!subs) {
      subs = new Set();
      this.subscriptions.set(clientId, subs);
    }
    for (const uid of sessionUids) {
      subs.add(uid);
    }
  }

  unsubscribe(clientId: string, sessionUids: string[]) {
    const subs = this.subscriptions.get(clientId);
    if (!subs) return;
    for (const uid of sessionUids) {
      subs.delete(uid);
    }
  }

  // Returns list of clients that should receive data for this session
  getSubscribers(sessionUid: string): string[] {
    const result: string[] = [];
    for (const [clientId, subs] of this.subscriptions) {
      if (subs.has(sessionUid)) {
        result.push(clientId);
      }
    }
    return result;
  }

  removeClient(clientId: string) {
    this.subscriptions.delete(clientId);
  }

  getClientSubscriptions(clientId: string): string[] {
    const subs = this.subscriptions.get(clientId);
    return subs ? Array.from(subs) : [];
  }
}
