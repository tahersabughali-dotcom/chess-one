/** A FIFO ring buffer with a fixed capacity. `offer` refuses instead of growing. */
export class BoundedQueue<T> {
  readonly capacity: number;
  readonly #slots: (T | undefined)[];
  #head = 0;
  #size = 0;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error("BoundedQueue capacity must be a positive integer");
    }
    this.capacity = capacity;
    this.#slots = new Array<T | undefined>(capacity).fill(undefined);
  }

  get size(): number {
    return this.#size;
  }

  offer(item: T): boolean {
    if (this.#size === this.capacity) return false;
    this.#slots[(this.#head + this.#size) % this.capacity] = item;
    this.#size += 1;
    return true;
  }

  shift(): T | undefined {
    if (this.#size === 0) return undefined;
    const item = this.#slots[this.#head];
    this.#slots[this.#head] = undefined;
    this.#head = (this.#head + 1) % this.capacity;
    this.#size -= 1;
    return item;
  }
}
