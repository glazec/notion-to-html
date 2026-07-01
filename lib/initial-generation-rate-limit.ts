import { checkRateLimitGroup, rateLimitKeyFromRequest } from "@/lib/rate-limit";

const initialGenerationWindowMs = 60 * 60 * 1000;

export function checkInitialGenerationRateLimit(request: Request): boolean {
  return checkRateLimitGroup([
    {
      key: rateLimitKeyFromRequest(request, "initial-generation"),
      limit: 20,
      windowMs: initialGenerationWindowMs,
    },
    {
      key: "global:initial-generation",
      limit: 120,
      windowMs: initialGenerationWindowMs,
    },
  ]);
}
