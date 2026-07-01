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
    upsertPageFromNotionUrl.mockResolvedValue({
      page_key: "37cf0ada243c81",
      slug: "1Money-6-11-2026-EN",
    });

    const { GET } = await import("@/app/[...pagePath]/route");
    const response = await GET(
      new Request("https://notion-to-html.test/https:/app.notion.com/p/iosgvc/1Money-6-11-2026-EN-37cf0ada243c81279b43e3a1603c6a43"),
      {
        params: Promise.resolve({
          pagePath: [
            "https:",
            "app.notion.com",
            "p",
            "iosgvc",
            "1Money-6-11-2026-EN-37cf0ada243c81279b43e3a1603c6a43",
          ],
        }),
      },
    );

    expect(upsertPageFromNotionUrl).toHaveBeenCalledWith(
      "https://app.notion.com/p/iosgvc/1Money-6-11-2026-EN-37cf0ada243c81279b43e3a1603c6a43",
      { userTransformed: false },
    );
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      name: "page/generate",
      data: expect.objectContaining({ pageKey: "37cf0ada243c81" }),
    }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://notion-to-html.test/1Money-6-11-2026-EN");
  });
});
