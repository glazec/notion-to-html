import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchPublicNotionContent = vi.fn();
const fetchNotionMarkdown = vi.fn();
const fetchNotionCommentsMarkdown = vi.fn();

vi.mock("@/lib/firecrawl", () => ({
  fetchPublicNotionContent,
}));

vi.mock("@/lib/notion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notion")>()),
  fetchNotionMarkdown,
  fetchNotionCommentsMarkdown,
}));

describe("content source selection", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    fetchPublicNotionContent.mockReset();
    fetchNotionMarkdown.mockReset();
    fetchNotionCommentsMarkdown.mockReset();
    fetchNotionCommentsMarkdown.mockResolvedValue({
      markdown: "",
      commentCount: 0,
      discussionCount: 0,
      truncated: false,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the authenticated Notion markdown source when a Notion key is configured", async () => {
    vi.stubEnv("NOTION_API_KEY", "ntn-test");
    vi.stubEnv("NOTION_PUBLIC_NOTION_API_PAGE_ALLOWLIST", "0123456789abcdef0123456789abcdef");
    fetchNotionMarkdown.mockResolvedValue({
      pageId: "01234567-89ab-cdef-0123-456789abcdef",
      url: "https://app.notion.com/p/ws/Page-0123456789abcdef0123456789abcdef",
      markdown: "# Private page",
    });

    const { fetchSourceContent } = await import("@/lib/content-source");
    const source = await fetchSourceContent("https://app.notion.com/p/ws/Page-0123456789abcdef0123456789abcdef");

    expect(source.sourceName).toBe("Notion API");
    expect(source.markdown).toBe("# Private page");
    expect(source.commentCount).toBe(0);
    expect(fetchPublicNotionContent).not.toHaveBeenCalled();
  });

  it("appends authenticated Notion comments to Notion markdown", async () => {
    vi.stubEnv("NOTION_API_KEY", "ntn-test");
    vi.stubEnv("NOTION_PUBLIC_NOTION_API_PAGE_ALLOWLIST", "01234567-89ab-cdef-0123-456789abcdef");
    fetchNotionMarkdown.mockResolvedValue({
      pageId: "01234567-89ab-cdef-0123-456789abcdef",
      url: "https://app.notion.com/p/ws/Page-0123456789abcdef0123456789abcdef",
      markdown: "# Private page",
    });
    fetchNotionCommentsMarkdown.mockResolvedValue({
      markdown: "## Notion comments\n\n### Comment thread 1\n> Useful comment",
      commentCount: 1,
      discussionCount: 1,
      truncated: false,
    });

    const { fetchSourceContent } = await import("@/lib/content-source");
    const source = await fetchSourceContent("https://app.notion.com/p/ws/Page-0123456789abcdef0123456789abcdef");

    expect(source.commentCount).toBe(1);
    expect(source.discussionCount).toBe(1);
    expect(source.markdown).toContain("# Private page");
    expect(source.markdown).toContain("## Notion comments");
    expect(source.markdown).toContain("Useful comment");
  });

  it("uses Firecrawl when the Notion key exists but the page is not allowlisted", async () => {
    vi.stubEnv("NOTION_API_KEY", "ntn-test");
    fetchPublicNotionContent.mockResolvedValue({
      pageId: "01234567-89ab-cdef-0123-456789abcdef",
      url: "https://app.notion.com/p/ws/Page-0123456789abcdef0123456789abcdef",
      markdown: "# Public page",
    });

    const { fetchSourceContent } = await import("@/lib/content-source");
    const source = await fetchSourceContent("https://app.notion.com/p/ws/Page-0123456789abcdef0123456789abcdef");

    expect(source.sourceName).toBe("Firecrawl");
    expect(fetchNotionMarkdown).not.toHaveBeenCalled();
  });

  it("does not treat wildcard as a Notion API page allowlist", async () => {
    vi.stubEnv("NOTION_API_KEY", "ntn-test");
    vi.stubEnv("NOTION_PUBLIC_NOTION_API_PAGE_ALLOWLIST", "*");
    fetchPublicNotionContent.mockResolvedValue({
      pageId: "01234567-89ab-cdef-0123-456789abcdef",
      url: "https://app.notion.com/p/ws/Page-0123456789abcdef0123456789abcdef",
      markdown: "# Public page",
    });

    const { fetchSourceContent } = await import("@/lib/content-source");
    const source = await fetchSourceContent("https://app.notion.com/p/ws/Page-0123456789abcdef0123456789abcdef");

    expect(source.sourceName).toBe("Firecrawl");
    expect(fetchNotionMarkdown).not.toHaveBeenCalled();
  });

  it("does not use the old generic Notion API allowlist for public publishing", async () => {
    vi.stubEnv("NOTION_API_KEY", "ntn-test");
    vi.stubEnv("NOTION_API_PAGE_ALLOWLIST", "0123456789abcdef0123456789abcdef");
    fetchPublicNotionContent.mockResolvedValue({
      pageId: "01234567-89ab-cdef-0123-456789abcdef",
      url: "https://app.notion.com/p/ws/Page-0123456789abcdef0123456789abcdef",
      markdown: "# Public page",
    });

    const { fetchSourceContent } = await import("@/lib/content-source");
    const source = await fetchSourceContent("https://app.notion.com/p/ws/Page-0123456789abcdef0123456789abcdef");

    expect(source.sourceName).toBe("Firecrawl");
    expect(fetchNotionMarkdown).not.toHaveBeenCalled();
  });

  it("falls back to Firecrawl when no Notion key is configured", async () => {
    fetchPublicNotionContent.mockResolvedValue({
      pageId: "01234567-89ab-cdef-0123-456789abcdef",
      url: "https://app.notion.com/p/ws/Page-0123456789abcdef0123456789abcdef",
      markdown: "# Public page",
    });

    const { fetchSourceContent } = await import("@/lib/content-source");
    const source = await fetchSourceContent("https://app.notion.com/p/ws/Page-0123456789abcdef0123456789abcdef");

    expect(source.sourceName).toBe("Firecrawl");
    expect(source.markdown).toBe("# Public page");
    expect(fetchNotionMarkdown).not.toHaveBeenCalled();
  });

  it("explains how to fix inaccessible public Notion pages", async () => {
    fetchPublicNotionContent.mockRejectedValue(
      new Error("Firecrawl returned a Notion sign-in page instead of page content."),
    );

    const { fetchSourceContent } = await import("@/lib/content-source");
    await expect(fetchSourceContent("https://app.notion.com/p/ws/Page-0123456789abcdef0123456789abcdef"))
      .rejects.toThrow(
        "Notion page is not accessible. No website was generated. To fix it: open the page in Notion, click Share, publish it to web, or share it with the configured Notion integration and ensure the page id is in NOTION_PUBLIC_NOTION_API_PAGE_ALLOWLIST. Then regenerate.",
      );
  });

  it("fails closed when public Notion API publishing is allowlisted but markdown fails", async () => {
    vi.stubEnv("NOTION_API_KEY", "ntn-test");
    vi.stubEnv("NOTION_PUBLIC_NOTION_API_PAGE_ALLOWLIST", "0123456789abcdef0123456789abcdef");
    fetchNotionMarkdown.mockRejectedValue(new Error("Notion markdown fetch failed: 403"));

    const { fetchSourceContent } = await import("@/lib/content-source");
    await expect(fetchSourceContent("https://app.notion.com/p/ws/Page-0123456789abcdef0123456789abcdef"))
      .rejects.toThrow(
        "Notion page is not accessible. No website was generated. To fix it: open the page in Notion, click Share, publish it to web, or share it with the configured Notion integration and ensure the page id is in NOTION_PUBLIC_NOTION_API_PAGE_ALLOWLIST. Then regenerate.",
      );
    expect(fetchPublicNotionContent).not.toHaveBeenCalled();
  });
});
