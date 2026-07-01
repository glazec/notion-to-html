import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, resetRateLimitsForTests } from "@/lib/rate-limit";

const findPage = vi.fn();
const markPageDirty = vi.fn();
const send = vi.fn();

vi.mock("@/lib/page-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/page-store")>()),
  findPage,
  markPageDirty,
}));

vi.mock("@/inngest/client", () => ({
  events: { generatePage: "page/generate" },
  inngest: { send },
}));

describe("regenerate route", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://notion-to-html.test");
    resetRateLimitsForTests();
    findPage.mockReset();
    markPageDirty.mockReset();
    send.mockReset();
    findPage.mockResolvedValue({
      page_key: "0123456789abcd",
      slug: "Test",
    });
  });

  it("does not burn the page regenerate bucket when the requester IP is already denied", async () => {
    const now = Date.now();
    for (let index = 0; index < 20; index += 1) {
      checkRateLimit({
        key: "203.0.113.80:regenerate",
        limit: 20,
        windowMs: 60 * 60 * 1000,
        now: now + index,
      });
    }

    const { POST } = await import("@/app/api/pages/[pageKey]/regenerate/route");
    const denied = await POST(regenerateRequest("203.0.113.80"), {
      params: Promise.resolve({ pageKey: "0123456789abcd" }),
    });
    const allowed = await POST(regenerateRequest("203.0.113.81"), {
      params: Promise.resolve({ pageKey: "0123456789abcd" }),
    });

    expect(denied.status).toBe(429);
    expect(allowed.status).toBe(303);
    expect(markPageDirty).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

function regenerateRequest(ip: string): Request {
  return new Request("https://notion-to-html.test/api/pages/0123456789abcd/regenerate", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}
