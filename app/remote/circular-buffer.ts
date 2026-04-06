/**
 * CircularBuffer - Fixed-size buffer for terminal output history
 * Automatically discards oldest data when capacity is exceeded
 */
export class CircularBuffer {
  private chunks: string[] = [];
  private totalSize = 0;
  private maxSize: number;

  constructor(maxSizeBytes: number = 2 * 1024 * 1024) {
    // Default 2MB
    this.maxSize = maxSizeBytes;
  }

  append(data: string) {
    this.chunks.push(data);
    this.totalSize += data.length;

    // Discard from head when exceeding limit
    while (this.totalSize > this.maxSize && this.chunks.length > 1) {
      const removed = this.chunks.shift()!;
      this.totalSize -= removed.length;
    }
  }

  getAll(): string {
    return this.chunks.join('');
  }

  getSize(): number {
    return this.totalSize;
  }

  clear() {
    this.chunks = [];
    this.totalSize = 0;
  }

  // Resize buffer and keep tail data
  resize(newMaxSize: number) {
    this.maxSize = newMaxSize;
    if (this.totalSize > newMaxSize) {
      const data = this.getAll();
      this.clear();
      // Keep tail data only
      this.append(data.slice(-newMaxSize));
    }
  }
}
