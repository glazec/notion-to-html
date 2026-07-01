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
    const fetchMock = vi.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => new Response(JSON.stringify({
      success: true,
      data: {
        markdown: "# Page",
        links: ["https://app.notion.com/p/ws/Child-0123456789abcdef0123456789abcdef"],
        images: ["https://example.com/image.png"],
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const source = await fetchPublicNotionContent(
      "https://app.notion.com/p/ws/Page-0123456789abcdef0123456789abcdef",
    );

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      formats: ["markdown", "links", "images"],
    });
    expect(source.pageId).toBe("01234567-89ab-cdef-0123-456789abcdef");
    expect(source.markdown).toContain("## Mentioned Notion pages");
    expect(source.markdown).toContain("## Images");
    expect(source.markdown).toContain("https://example.com/image.png");
  });

  it("rejects Notion sign-in pages returned by Firecrawl", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        markdown: [
          "You’re almost there!",
          "Sign in to see this page in **IOSG Ventures**",
          "Email",
          "Continue",
        ].join("\n\n"),
        links: ["https://app.notion.com/signup"],
        images: [],
      },
    }), { status: 200 })));

    await expect(fetchPublicNotionContent(
      "https://app.notion.com/p/iosgvc/RWA-Where-are-we-now-Can-big-companies-win-it-all-What-kind-of-projects-are-more-likely-35cf0ada243c808abb24deca7fe22fab",
    )).rejects.toThrow("Firecrawl returned a Notion sign-in page");
  });
});
