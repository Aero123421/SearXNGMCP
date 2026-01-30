import { LRUCache } from "lru-cache";

export class MemoryCache<T extends object> {
  private readonly cache: LRUCache<string, T>;

  constructor(options: { maxEntries: number; ttlMs: number }) {
    this.cache = new LRUCache<string, T>({
      max: options.maxEntries,
      ttl: options.ttlMs
    });
  }

  get(key: string): T | undefined {
    return this.cache.get(key);
  }

  set(key: string, value: T): void {
    this.cache.set(key, value);
  }
}
