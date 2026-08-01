import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitsForTests } from "@/lib/rate-limit";

const send = vi.fn();
const createUserSiteFromNotionUrl = vi.fn();
const getCurrentUser = vi.fn();
const findPageBySlug = vi.fn();
const servedPageResponse = vi.fn();

vi.mock("@/inngest/client", () => ({
  events: { generatePage: "page/generate" },
  inngest: { send },
}));

vi.mock("@/lib/page-store", () => ({
  findPageBySlug,
}));

vi.mock("@/lib/auth/server", () => ({ getCurrentUser }));

vi.mock("@/lib/site-credits", () => ({
  createUserSiteFromNotionUrl,
  isDailySiteLimitError: () => false,
}));

vi.mock("@/lib/page-response", () => ({
  servedPageResponse,
}));

describe("root path route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://notion-to-html.test");
    resetRateLimitsForTests();
    send.mockReset();
    getCurrentUser.mockReset();
    getCurrentUser.mockResolvedValue({ id: "user-1", email: "reader@example.com" });
    createUserSiteFromNotionUrl.mockReset();
    findPageBySlug.mockReset();
    servedPageResponse.mockReset();
  });

  it("redirects a pasted Notion URL path into the generated page route", async () => {
    const { GET } = await import("@/app/[...pagePath]/route");

    const cases = [
      {
        inputPath: "https:/app.notion.com/p/iosgvc/1Money-6-11-2026-EN-37cf0ada243c81279b43e3a1603c6a43",
        pagePath: [
          "https:",
          "app.notion.com",
          "p",
          "iosgvc",
          "1Money-6-11-2026-EN-37cf0ada243c81279b43e3a1603c6a43",
        ],
        notionUrl: "https://app.notion.com/p/iosgvc/1Money-6-11-2026-EN-37cf0ada243c81279b43e3a1603c6a43",
        pageKey: "37cf0ada243c81",
        slug: "1Money-6-11-2026-EN",
      },
      {
        inputPath: "https:/www.notion.so/workspace/Different-Page-fedcba9876543210fedcba9876543210",
        pagePath: [
          "https:",
          "www.notion.so",
          "workspace",
          "Different-Page-fedcba9876543210fedcba9876543210",
        ],
        notionUrl: "https://www.notion.so/workspace/Different-Page-fedcba9876543210fedcba9876543210",
        pageKey: "fedcba98765432",
        slug: "Different-Page",
      },
    ];

    for (const testCase of cases) {
      createUserSiteFromNotionUrl.mockResolvedValueOnce({
        page: { page_key: testCase.pageKey, slug: testCase.slug },
        siteCreated: true,
      });

      const response = await GET(
        new Request(`https://notion-to-html.test/${testCase.inputPath}`),
        {
          params: Promise.resolve({
            pagePath: testCase.pagePath,
          }),
        },
      );

      expect(createUserSiteFromNotionUrl).toHaveBeenLastCalledWith({
        notionUrl: testCase.notionUrl,
        userId: "user-1",
        email: "reader@example.com",
      });
      expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
        name: "page/generate",
        data: expect.objectContaining({ pageKey: testCase.pageKey }),
      }));
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`https://notion-to-html.test/${testCase.slug}`);
    }
  });

  it("treats app.no7ion.com paths as app.notion.com source URLs", async () => {
    const { GET } = await import("@/app/[...pagePath]/route");
    createUserSiteFromNotionUrl.mockResolvedValueOnce({
      page: {
        page_key: "38bf0ada243c80",
        slug: "Computation-Financialization-Sourcing",
      },
      siteCreated: true,
    });

    const response = await GET(
      new Request("https://app.no7ion.com/p/iosgvc/Computation-Financialization-Sourcing-38bf0ada243c80c0b59ccb6d3dd4ab0d"),
      {
        params: Promise.resolve({
          pagePath: [
            "p",
            "iosgvc",
            "Computation-Financialization-Sourcing-38bf0ada243c80c0b59ccb6d3dd4ab0d",
          ],
        }),
      },
    );

    expect(createUserSiteFromNotionUrl).toHaveBeenCalledWith({
      notionUrl: "https://app.notion.com/p/iosgvc/Computation-Financialization-Sourcing-38bf0ada243c80c0b59ccb6d3dd4ab0d",
      userId: "user-1",
      email: "reader@example.com",
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      name: "page/generate",
      data: expect.objectContaining({
        pageKey: "38bf0ada243c80",
        source: "pasted-url-path",
      }),
    }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://notion-to-html.test/Computation-Financialization-Sourcing");
  });

  it("rate limits pasted URL path generation before creating more jobs", async () => {
    const { GET } = await import("@/app/[...pagePath]/route");
    createUserSiteFromNotionUrl.mockResolvedValue({
      page: { page_key: "37cf0ada243c81", slug: "1Money-6-11-2026-EN" },
      siteCreated: true,
    });
    const pagePath = [
      "https:",
      "app.notion.com",
      "p",
      "iosgvc",
      "1Money-6-11-2026-EN-37cf0ada243c81279b43e3a1603c6a43",
    ];

    for (let index = 0; index < 20; index += 1) {
      const response = await GET(pathRequest("203.0.113.51"), { params: Promise.resolve({ pagePath }) });
      expect(response.status).toBe(303);
    }

    const denied = await GET(pathRequest("203.0.113.51"), { params: Promise.resolve({ pagePath }) });

    expect(denied.status).toBe(429);
    expect(await denied.json()).toEqual({ error: "Initial generation rate limit exceeded" });
    expect(createUserSiteFromNotionUrl).toHaveBeenCalledTimes(20);
    expect(send).toHaveBeenCalledTimes(20);
  });
});

function pathRequest(ip: string): Request {
  return new Request("https://notion-to-html.test/https:/app.notion.com/p/iosgvc/1Money-6-11-2026-EN-37cf0ada243c81279b43e3a1603c6a43", {
    headers: { "x-forwarded-for": ip },
  });
}
