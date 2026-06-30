import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPublicNotionContent } from "@/lib/firecrawl";

describe("Firecrawl content source", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("fetches markdown and appends discovered Notion links and images", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        markdown: "# Page",
        links: ["https://app.notion.com/p/ws/Child-0123456789abcdef0123456789abcdef"],
        images: ["https://example.com/image.png"],
      },
    }), { status: 200 })));

    const source = await fetchPublicNotionContent(
      "https://app.notion.com/p/ws/Page-0123456789abcdef0123456789abcdef",
    );

    expect(source.pageId).toBe("01234567-89ab-cdef-0123-456789abcdef");
    expect(source.markdown).toContain("## Mentioned Notion pages");
    expect(source.markdown).toContain("## Images");
    expect(source.markdown).toContain("https://example.com/image.png");
  });
});
