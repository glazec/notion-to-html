import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
const upsertPageFromNotionUrl = vi.fn();
const findPageBySlug = vi.fn();
const servedPageResponse = vi.fn();

vi.mock("@/inngest/client", () => ({
  events: { generatePage: "page/generate" },
  inngest: { send },
}));

vi.mock("@/lib/page-store", () => ({
  upsertPageFromNotionUrl,
  findPageBySlug,
}));

vi.mock("@/lib/page-response", () => ({
  servedPageResponse,
}));

describe("root path route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://notion-to-html.test");
    send.mockReset();
    upsertPageFromNotionUrl.mockReset();
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
      upsertPageFromNotionUrl.mockResolvedValueOnce({
        page_key: testCase.pageKey,
        slug: testCase.slug,
      });

      const response = await GET(
        new Request(`https://notion-to-html.test/${testCase.inputPath}`),
        {
          params: Promise.resolve({
            pagePath: testCase.pagePath,
          }),
        },
      );

      expect(upsertPageFromNotionUrl).toHaveBeenLastCalledWith(
        testCase.notionUrl,
        { userTransformed: false },
      );
      expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
        name: "page/generate",
        data: expect.objectContaining({ pageKey: testCase.pageKey }),
      }));
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`https://notion-to-html.test/${testCase.slug}`);
    }
  });
});
