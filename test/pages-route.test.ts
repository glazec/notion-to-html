import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitsForTests } from "@/lib/rate-limit";

const send = vi.fn();
const createUserSiteFromNotionUrl = vi.fn();
const getCurrentUser = vi.fn();

vi.mock("@/inngest/client", () => ({
  events: { generatePage: "page/generate" },
  inngest: { send },
}));

vi.mock("@/lib/auth/server", () => ({ getCurrentUser }));

vi.mock("@/lib/site-credits", () => ({
  createUserSiteFromNotionUrl,
  isDailySiteLimitError: () => false,
}));

describe("pages route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://notion-to-html.test");
    resetRateLimitsForTests();
    send.mockReset();
    getCurrentUser.mockReset();
    getCurrentUser.mockResolvedValue({ id: "user-1", email: "reader@example.com" });
    createUserSiteFromNotionUrl.mockReset();
    createUserSiteFromNotionUrl.mockResolvedValue({
      page: { page_key: "0123456789abcd", slug: "Test" },
      siteCreated: true,
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
    expect(createUserSiteFromNotionUrl).toHaveBeenCalledTimes(20);
    expect(send).toHaveBeenCalledTimes(20);
  });

  it("requires Google authentication before spending a site credit", async () => {
    getCurrentUser.mockResolvedValueOnce(null);
    const { POST } = await import("@/app/api/pages/route");
    const response = await POST(pageRequest(
      "https://app.notion.com/p/ws/Test-0123456789abcdef0123456789abcdef",
      "203.0.113.50",
    ));

    expect(response.status).toBe(401);
    expect(createUserSiteFromNotionUrl).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
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
