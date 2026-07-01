import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitsForTests } from "@/lib/rate-limit";

const send = vi.fn();
const upsertPageFromNotionUrl = vi.fn();

vi.mock("@/inngest/client", () => ({
  events: { generatePage: "page/generate" },
  inngest: { send },
}));

vi.mock("@/lib/page-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/page-store")>()),
  upsertPageFromNotionUrl,
}));

describe("pages route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://notion-to-html.test");
    resetRateLimitsForTests();
    send.mockReset();
    upsertPageFromNotionUrl.mockReset();
    upsertPageFromNotionUrl.mockResolvedValue({
      page_key: "0123456789abcd",
      slug: "Test",
    });
  });

  it("rate limits initial page generation before creating more jobs", async () => {
    const { POST } = await import("@/app/api/pages/route");
    const notionUrl = "https://app.notion.com/p/ws/Test-0123456789abcdef0123456789abcdef";

    for (let index = 0; index < 20; index += 1) {
      const response = await POST(pageRequest(notionUrl, "203.0.113.50"));
      expect(response.status).toBe(303);
    }

    const denied = await POST(pageRequest(notionUrl, "203.0.113.50"));

    expect(denied.status).toBe(429);
    expect(await denied.json()).toEqual({ error: "Initial generation rate limit exceeded" });
    expect(upsertPageFromNotionUrl).toHaveBeenCalledTimes(20);
    expect(send).toHaveBeenCalledTimes(20);
  });
});

function pageRequest(notionUrl: string, ip: string): Request {
  return new Request("https://notion-to-html.test/api/pages", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": ip,
    },
    body: new URLSearchParams({ notionUrl }),
  });
}
