type LoginRateLimitOptions = { windowMs?: number; maxAttempts?: number; now?: () => number };

export function createLoginRateLimiter(options: LoginRateLimitOptions = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const maxAttempts = options.maxAttempts ?? 5;
  const now = options.now ?? Date.now;
  const attemptsByIp = new Map<string, number[]>();

  return {
    isLimited(ip: string): boolean {
      const current = now();
      const recent = (attemptsByIp.get(ip) ?? []).filter((timestamp) => current - timestamp < windowMs);
      if (recent.length >= maxAttempts) {
        attemptsByIp.set(ip, recent);
        return true;
      }
      recent.push(current);
      attemptsByIp.set(ip, recent);
      if (attemptsByIp.size > 10_000) {
        for (const [key, timestamps] of attemptsByIp) {
          if (timestamps.every((timestamp) => current - timestamp >= windowMs)) attemptsByIp.delete(key);
        }
      }
      return false;
    },
    clear(ip: string): void {
      attemptsByIp.delete(ip);
    },
  };
}
