import { beforeEach, describe, expect, it, vi } from "vitest";

const findPage = vi.fn();
const setPageGenerationProgress = vi.fn();
const setPageStatus = vi.fn();
const completePageGeneration = vi.fn();
const generateDocumentHtmlBody = vi.fn();
const fetchPublicNotionContent = vi.fn();
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

vi.mock("@/lib/firecrawl", () => ({
  fetchPublicNotionContent,
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
    fetchPublicNotionContent.mockReset();
    putHtmlObject.mockReset();
  });

  it("writes heartbeat log entries while Codex HTML generation is running", async () => {
    const html = deferred<string>();
    findPage.mockResolvedValue({
      page_key: "abc123",
      notion_url: "https://notion.so/test",
    });
    fetchPublicNotionContent.mockResolvedValue({
      markdown: "# Hello\n\nBody",
      url: "https://notion.so/test",
      pageId: "page-id",
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
      step: "Codex generation still running (2m)",
      progress: 77,
    }));

    html.resolve("<main>Generated</main>");
    await generation;

    expect(completePageGeneration).toHaveBeenCalled();
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
    expect(fetchPublicNotionContent).not.toHaveBeenCalled();
    expect(generateDocumentHtmlBody).not.toHaveBeenCalled();
  });
});
