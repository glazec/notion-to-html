import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitsForTests } from "@/lib/rate-limit";

const findPage = vi.fn();
const setPagePreferredLanguage = vi.fn();
const send = vi.fn();

vi.mock("@/lib/page-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/page-store")>()),
  findPage,
  setPagePreferredLanguage,
}));

vi.mock("@/inngest/client", () => ({
  events: { generatePage: "page/generate" },
  inngest: { send },
}));

describe("language route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://notion-to-html.test");
    resetRateLimitsForTests();
    findPage.mockReset();
    setPagePreferredLanguage.mockReset();
    send.mockReset();
    findPage.mockResolvedValue({
      page_key: "0123456789abcd",
      slug: "Test",
      preferred_language: "auto",
    });
  });

  it("persists the selected page language and queues regeneration", async () => {
    setPagePreferredLanguage.mockResolvedValue({
      page_key: "0123456789abcd",
      preferred_language: "zh-CN",
    });

    const { POST } = await import("@/app/api/pages/[pageKey]/language/route");
    const response = await POST(languageRequest("zh-CN"), {
      params: Promise.resolve({ pageKey: "0123456789abcd" }),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://notion-to-html.test/p/0123456789abcd");
    expect(setPagePreferredLanguage).toHaveBeenCalledWith("0123456789abcd", "zh-CN", expect.any(Date));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      name: "page/generate",
      data: expect.objectContaining({
        pageKey: "0123456789abcd",
        reason: "language-update",
        targetLanguage: "zh-CN",
      }),
    }));
  });

  it("rejects unsupported language values before mutating the page", async () => {
    const { POST } = await import("@/app/api/pages/[pageKey]/language/route");
    const response = await POST(languageRequest("klingon"), {
      params: Promise.resolve({ pageKey: "0123456789abcd" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unsupported language" });
    expect(setPagePreferredLanguage).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

function languageRequest(language: string): Request {
  return new Request("https://notion-to-html.test/api/pages/0123456789abcd/language", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": "203.0.113.90",
    },
    body: new URLSearchParams({ language }),
  });
}
