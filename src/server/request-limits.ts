/**
 * Request execution guardrails: concurrency and timeouts.
 *
 * These are transport-level protections around triage execution.
 * Business rules and persistence live elsewhere.
 */

/**
 * Race a promise against a timeout. Rejects with
 * `Error("request_timeout")` when the deadline expires.
 */
export async function withRequestTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("request_timeout")), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/** Simple non-queuing guard: at most `limit` concurrent holders. */
export class ConcurrencyLimiter {
  private active = 0;

  constructor(private readonly limit: number) {}

  tryAcquire(): boolean {
    if (this.active >= this.limit) {
      return false;
    }
    this.active += 1;
    return true;
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
  }
}

const limiters = new WeakMap<object, ConcurrencyLimiter>();

/**
 * Return the limiter bound to a dependencies object, creating it
 * on first use so each server instance has its own budget.
 */
export function limiterFor(key: object, limit: number): ConcurrencyLimiter {
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = new ConcurrencyLimiter(limit);
    limiters.set(key, limiter);
  }
  return limiter;
}
