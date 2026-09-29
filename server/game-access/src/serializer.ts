/**
 * Runs tasks one at a time per key, in call order. A key is held only while
 * it has a task pending, so the map's size is the number of keys with work
 * in flight. It orders control changes of one game inside this process
 * (LIVE-WRITER-OWNERSHIP-001: one process); the store's version check still
 * refuses a change another process made first.
 */
export class KeyedSerializer<K> {
  readonly #tails = new Map<K, Promise<void>>();

  get size(): number {
    return this.#tails.size;
  }

  run<T>(key: K, task: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    const result = previous.then(task);
    // The caller receives the task's failure through `result`; the chain only waits for it to settle.
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.#tails.set(key, tail);
    tail.then(() => {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    });
    return result;
  }
}
