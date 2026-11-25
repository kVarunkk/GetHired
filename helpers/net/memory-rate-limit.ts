import "server-only";

// A sliding-window limit kept in this instance's memory (AT-REQ-037 accepts
// per-instance counting for v1). Each key keeps the times of its recent hits.

export type RateLimiter = {
  /** Counts a hit for `key` and says whether it's allowed. A refused hit isn't counted. */
  hit(key: string): { allowed: true; remaining: number } | { allowed: false; retryAfterMs: number };
  reset(): void;
};

export function createMemoryRateLimiter({
  limit,
  windowMs,
  now = Date.now,
  maxKeys = 10_000,
}: {
  limit: number;
  windowMs: number;
  now?: () => number;
  /** Past this many keys the oldest are dropped, so memory stays bounded. */
  maxKeys?: number;
}): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    hit(key) {
      const time = now();
      const recent = (hits.get(key) ?? []).filter((at) => time - at < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { allowed: false, retryAfterMs: windowMs - (time - recent[0]) };
      }
      recent.push(time);
      hits.delete(key);
      hits.set(key, recent);
      if (hits.size > maxKeys) hits.delete(hits.keys().next().value as string);
      return { allowed: true, remaining: limit - recent.length };
    },
    reset() {
      hits.clear();
    },
  };
}
