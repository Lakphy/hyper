/**
 * AdaptiveThrottler - Automatically throttles high-frequency terminal output
 * Protects network and rendering performance during bursts (npm install, tail -f, etc.)
 */
export class AdaptiveThrottler {
  private rates = new Map<string, {bytes: number; windowStart: number}>();
  private readonly windowMs = 1000; // 1 second window
  private readonly throttleThreshold = 256 * 1024; // 256KB/s starts throttling
  private readonly hardLimit = 1024 * 1024; // 1MB/s hard limit

  /**
   * Returns action to take for this data:
   * - 'send': send data as-is
   * - 'throttle': send summarized version
   * - 'drop': discard completely
   */
  shouldSend(uid: string, dataSize: number): 'send' | 'throttle' | 'drop' {
    const now = Date.now();
    let rate = this.rates.get(uid);

    if (!rate || now - rate.windowStart > this.windowMs) {
      rate = {bytes: 0, windowStart: now};
      this.rates.set(uid, rate);
    }

    rate.bytes += dataSize;

    if (rate.bytes > this.hardLimit) {
      return 'drop';
    }
    if (rate.bytes > this.throttleThreshold) {
      return 'throttle';
    }
    return 'send';
  }

  /**
   * Throttle mode: keep only last N lines + summary
   */
  summarize(data: string): string {
    const lines = data.split('\n');
    if (lines.length <= 5) return data;
    return `\x1b[2m[... ${lines.length - 3} lines throttled ...]\x1b[0m\n` + lines.slice(-3).join('\n');
  }

  reset(uid: string) {
    this.rates.delete(uid);
  }
}
