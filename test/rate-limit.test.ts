import { describe, expect, it } from "vitest";
import {
  checkRateLimit,
  checkRateLimitGroup,
  rateLimitKeyFromRequest,
  resetRateLimitsForTests,
} from "@/lib/rate-limit";

describe("rate limit", () => {
  it("limits hits inside a window", () => {
    resetRateLimitsForTests();
    expect(checkRateLimit({ key: "a", limit: 2, windowMs: 1000, now: 1000 })).toBe(true);
    expect(checkRateLimit({ key: "a", limit: 2, windowMs: 1000, now: 1001 })).toBe(true);
    expect(checkRateLimit({ key: "a", limit: 2, windowMs: 1000, now: 1002 })).toBe(false);
    expect(checkRateLimit({ key: "a", limit: 2, windowMs: 1000, now: 2102 })).toBe(true);
  });

  it("does not consume later buckets when one bucket is already denied", () => {
    resetRateLimitsForTests();
    expect(checkRateLimit({ key: "ip", limit: 1, windowMs: 1000, now: 1000 })).toBe(true);

    expect(checkRateLimitGroup([
      { key: "ip", limit: 1, windowMs: 1000, now: 1001 },
      { key: "global", limit: 1, windowMs: 1000, now: 1001 },
    ])).toBe(false);

    expect(checkRateLimit({ key: "global", limit: 1, windowMs: 1000, now: 1002 })).toBe(true);
  });

  it("uses the rightmost forwarded IP to avoid client prepended spoofing", () => {
    const request = new Request("https://app.test", {
      headers: {
        "x-forwarded-for": "198.51.100.1, 203.0.113.10",
      },
    });

    expect(rateLimitKeyFromRequest(request, "initial-generation")).toBe("203.0.113.10:initial-generation");
  });
});
