const buckets = new Map<string, number[]>();

export function checkRateLimit(input: {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}): boolean {
  const now = input.now ?? Date.now();
  const start = now - input.windowMs;
  const hits = (buckets.get(input.key) ?? []).filter((hit) => hit > start);

  if (hits.length >= input.limit) {
    buckets.set(input.key, hits);
    return false;
  }

  hits.push(now);
  buckets.set(input.key, hits);
  return true;
}

export function rateLimitKeyFromRequest(request: Request, suffix: string): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  return `${ip}:${suffix}`;
}
