import { appendFile } from "node:fs/promises";

export class BufferedWriter {
  #buffer = [];
  #path;
  #maxSize;
  #flushTimer = null;
  #flushInterval;
  #flushing = false;

  constructor(path, { maxSize, flushInterval } = {}) {
    this.#path = path;
    this.#maxSize = maxSize;
    this.#flushInterval = flushInterval;
    this.#startAutoFlush();
  }

  push(line) {
    this.#buffer.push(line);
    if (this.#buffer.length >= this.#maxSize) {
      this.flush();
    }
  }

  async flush() {
    if (this.#flushing || this.#buffer.length === 0) return;
    this.#flushing = true;

    const batch = this.#buffer.splice(0);
    try {
      await appendFile(this.#path, batch.join("\n") + "\n");
    } catch (err) {
      throw err;
    } finally {
      this.#flushing = false;
    }
  }

  #startAutoFlush() {
    this.#flushTimer = setInterval(() => this.flush(), this.#flushInterval);
    this.#flushTimer.unref();
  }

  async close() {
    clearInterval(this.#flushTimer);
    await this.flush();
  }
}
