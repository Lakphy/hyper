/**
 * WSDataBatcher - Batches WebSocket messages to reduce send() calls
 * Uses same strategy as DataBatcher: 16ms interval or 200KB size threshold
 */
export class WSDataBatcher {
  private buffer: Buffer[] = [];
  private bufferSize = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly flushIntervalMs = 16;
  private readonly maxBatchSize = 200 * 1024;

  constructor(private onFlush: (batch: Buffer) => void) {}

  write(encoded: Buffer) {
    this.buffer.push(encoded);
    this.bufferSize += encoded.length;

    if (this.bufferSize >= this.maxBatchSize) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.flush();
      return;
    }

    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  flush() {
    if (this.buffer.length === 0) return;
    // Single message: send directly; multiple: concat
    const batch = this.buffer.length === 1 ? this.buffer[0] : Buffer.concat(this.buffer, this.bufferSize);
    this.buffer = [];
    this.bufferSize = 0;
    this.timer = null;
    this.onFlush(batch);
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.buffer = [];
    this.bufferSize = 0;
  }
}
