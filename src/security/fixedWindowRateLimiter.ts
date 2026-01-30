import { LRUCache } from "lru-cache";

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

type Entry = {
  count: number;
  resetAt: number;
};

export class FixedWindowRateLimiter {
  private readonly cache: LRUCache<string, Entry>;

  constructor(options?: { maxEntries?: number }) {
    this.cache = new LRUCache({
      max: options?.maxEntries ?? 50_000
    });
  }

  consume(params: {
    key: string;
    limit: number;
    windowMs: number;
    now?: number;
  }): RateLimitDecision {
    const now = params.now ?? Date.now();
    const windowMs = params.windowMs;
    const limit = params.limit;
    const key = params.key;

    const existing = this.cache.get(key);
    if (!existing || existing.resetAt <= now) {
      const resetAt = now + windowMs;
      const entry: Entry = { count: 1, resetAt };
      this.cache.set(key, entry, { ttl: windowMs });
      return { allowed: true, remaining: limit - 1, resetAt };
    }

    const nextCount = existing.count + 1;
    existing.count = nextCount;
    this.cache.set(key, existing);

    const allowed = nextCount <= limit;
    const remaining = Math.max(0, limit - nextCount);
    return { allowed, remaining, resetAt: existing.resetAt };
  }
}

