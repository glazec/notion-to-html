import { beforeEach, describe, expect, it, vi } from "vitest";

const findPage = vi.fn();
const setPageGenerationProgress = vi.fn();
const setPageStatus = vi.fn();
const completePageGeneration = vi.fn();
const generateDocumentHtmlBody = vi.fn();
const fetchSourceContent = vi.fn();
const prepareSourceAssets = vi.fn();
const putHtmlObject = vi.fn();

vi.mock("@/lib/page-store", () => ({
  findPage,
  setPageGenerationProgress,
  setPageStatus,
  completePageGeneration,
}));

vi.mock("@/lib/codex-generator", () => ({
  generateDocumentHtmlBody,
}));

vi.mock("@/lib/content-source", () => ({
  fetchSourceContent,
}));

vi.mock("@/lib/source-assets", () => ({
  prepareSourceAssets,
}));

vi.mock("@/lib/bucket", () => ({
  putHtmlObject,
  getHtmlObject: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe("page generation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
    findPage.mockReset();
    setPageGenerationProgress.mockReset();
    setPageStatus.mockReset();
    completePageGeneration.mockReset();
    generateDocumentHtmlBody.mockReset();
    fetchSourceContent.mockReset();
    prepareSourceAssets.mockReset();
    prepareSourceAssets.mockImplementation(async ({ markdown }) => ({ markdown, images: [] }));
    putHtmlObject.mockReset();
  });

  it("writes heartbeat log entries while Codex HTML generation is running", async () => {
    const html = deferred<string>();
    findPage.mockResolvedValue({
      page_key: "abc123",
      notion_url: "https://notion.so/test",
    });
    fetchSourceContent.mockResolvedValue({
      markdown: "# Hello\n\nBody",
      url: "https://notion.so/test",
      pageId: "page-id",
      sourceName: "Notion API",
      commentCount: 0,
      discussionCount: 0,
    });
    generateDocumentHtmlBody.mockReturnValue(html.promise);

    const { generatePage } = await import("@/lib/generation");
    const generation = generatePage("abc123");

    await vi.waitFor(() => {
      expect(generateDocumentHtmlBody).toHaveBeenCalled();
    });

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

    expect(setPageGenerationProgress).toHaveBeenCalledWith(expect.objectContaining({
      pageKey: "abc123",
      status: "generating",
      step: "Codex still running: 13 chars, 0 images, 0 Notion links, 0 comments (2m)",
      progress: 77,
    }));

    html.resolve("<main>Generated</main>");
    await generation;

    expect(completePageGeneration).toHaveBeenCalled();
  });

  it("writes detailed logs for scrape, assets, links, Codex, and publish", async () => {
    findPage.mockResolvedValue({
      page_key: "abc123",
      notion_url: "https://notion.so/test",
    });
    fetchSourceContent.mockResolvedValue({
      markdown: [
        "# Hello",
        "![Demo](https://example.com/demo.png)",
        "[Child](https://app.notion.com/p/workspace/Child-0123456789abcdef0123456789abcdef)",
      ].join("\n\n"),
      url: "https://notion.so/test",
      pageId: "page-id",
      sourceName: "Notion API",
      commentCount: 2,
      discussionCount: 1,
    });
    prepareSourceAssets.mockResolvedValue({
      markdown: "# Hello\n\n![Demo](/assets/pages/page-id/images/demo.png)",
      images: [{
        alt: "Demo",
        sourceUrl: "https://example.com/demo.png",
        localUrl: "/assets/pages/page-id/images/demo.png",
        objectKey: "assets/pages/page-id/images/demo.png",
        description: "Demo screenshot",
      }],
    });
    generateDocumentHtmlBody.mockResolvedValue("<main>Generated</main>");

    const { generatePage } = await import("@/lib/generation");
    await generatePage("abc123");

    const steps = setPageGenerationProgress.mock.calls.map(([input]) => input.step);
    expect(steps).toContain("Fetching Notion content source");
    expect(steps.some((step) => /^Notion API returned \d+ markdown chars$/.test(step))).toBe(true);
    expect(steps).toContain("Preparing source assets: 1 image, 1 Notion link");
    expect(steps).toContain("Stored and described 1 image");
    expect(steps).toContain("Preserving 1 linked Notion page");
    expect(steps).toContain("Included 2 Notion comments from 1 discussion");
    expect(steps).toContain("Starting Codex document-to-html generation: 1 image, 1 Notion link");
    expect(steps).toContain("Publishing cached HTML object");
  });

  it("passes the page language preference into Codex HTML generation", async () => {
    findPage.mockResolvedValue({
      page_key: "abc123",
      notion_url: "https://notion.so/test",
      preferred_language: "zh-CN",
    });
    fetchSourceContent.mockResolvedValue({
      markdown: "# Hello\n\nEnglish source.",
      url: "https://notion.so/test",
      pageId: "page-id",
      sourceName: "Notion API",
      commentCount: 0,
      discussionCount: 0,
    });
    generateDocumentHtmlBody.mockResolvedValue("<main>生成内容</main>");

    const { generatePage } = await import("@/lib/generation");
    await generatePage("abc123");

    expect(generateDocumentHtmlBody).toHaveBeenCalledWith(expect.objectContaining({
      markdown: "# Hello\n\nEnglish source.",
      notionUrl: "https://notion.so/test",
      targetLanguage: "zh-CN",
    }));
  });

  it("does not publish HTML when the Notion source is inaccessible", async () => {
    const accessMessage = "Notion page is not accessible. No website was generated. To fix it: open the page in Notion, click Share, publish it to web, or share it with the configured Notion integration and ensure the page id is in NOTION_PUBLIC_NOTION_API_PAGE_ALLOWLIST. Then regenerate.";
    findPage.mockResolvedValue({
      page_key: "abc123",
      notion_url: "https://notion.so/test",
    });
    fetchSourceContent.mockRejectedValue(new Error(accessMessage));

    const { generatePage } = await import("@/lib/generation");
    await expect(generatePage("abc123")).rejects.toThrow(accessMessage);

    expect(setPageStatus).toHaveBeenCalledWith("abc123", "failed", accessMessage);
    expect(prepareSourceAssets).not.toHaveBeenCalled();
    expect(generateDocumentHtmlBody).not.toHaveBeenCalled();
    expect(putHtmlObject).not.toHaveBeenCalled();
    expect(completePageGeneration).not.toHaveBeenCalled();
  });

  it("skips stale duplicate generation events when the page is already ready", async () => {
    findPage.mockResolvedValue({
      page_key: "abc123",
      notion_url: "https://notion.so/test",
      current_hash: "current-hash",
      status: "ready",
      dirty_at: null,
    });

    const { generatePage } = await import("@/lib/generation");
    const result = await generatePage("abc123");

    expect(result).toMatchObject({
      pageKey: "abc123",
      skipped: true,
      reason: "already-ready",
    });
    expect(fetchSourceContent).not.toHaveBeenCalled();
    expect(generateDocumentHtmlBody).not.toHaveBeenCalled();
  });
});
