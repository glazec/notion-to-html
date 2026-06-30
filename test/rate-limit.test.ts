import { describe, expect, it } from "vitest";
import { checkRateLimit } from "@/lib/rate-limit";

describe("rate limit", () => {
  it("limits hits inside a window", () => {
    expect(checkRateLimit({ key: "a", limit: 2, windowMs: 1000, now: 1000 })).toBe(true);
    expect(checkRateLimit({ key: "a", limit: 2, windowMs: 1000, now: 1001 })).toBe(true);
    expect(checkRateLimit({ key: "a", limit: 2, windowMs: 1000, now: 1002 })).toBe(false);
    expect(checkRateLimit({ key: "a", limit: 2, windowMs: 1000, now: 2102 })).toBe(true);
  });
});
