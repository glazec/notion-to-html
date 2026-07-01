const buckets = new Map<string, number[]>();

type RateLimitInput = {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
};

export function checkRateLimit(input: RateLimitInput): boolean {
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

export function checkRateLimitGroup(inputs: RateLimitInput[]): boolean {
  const now = Date.now();
  const checks = inputs.map((input) => ({
    ...input,
    now: input.now ?? now,
  }));

  if (!checks.every(isRateLimitAvailable)) return false;

  for (const input of checks) {
    checkRateLimit(input);
  }

  return true;
}

function isRateLimitAvailable(input: RateLimitInput): boolean {
  const now = input.now ?? Date.now();
  const start = now - input.windowMs;
  const hits = (buckets.get(input.key) ?? []).filter((hit) => hit > start);
  return hits.length < input.limit;
}

export function rateLimitKeyFromRequest(request: Request, suffix: string): string {
  const forwarded = request.headers.get("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1);
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  return `${ip}:${suffix}`;
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
}
