import { describe, expect, it } from "vitest";

describe("generated HTML connections", () => {
  it("rewrites Notion links and appends missing image and subpage connections", async () => {
    const { preserveGeneratedConnections } = await import("@/lib/generated-connections");
    const html = [
      "<style data-document-to-html></style>",
      "<main class=\"document-html-page wrap\">",
      "<section><p>Generated body</p></section>",
      "<section><a href=\"https://app.notion.com/p/ws/Child-0123456789abcdef0123456789abcdef\">Direct child</a></section>",
      "</main>",
    ].join("");
    const markdown = [
      "# Source",
      "![Product demo](/assets/pages/page-id/images/demo.png)",
      "Codex image description: Product UI demo with the core settlement flow.",
      "## Mentioned Notion pages",
      "- [Research appendix](https://app.notion.com/p/ws/Appendix-fedcba9876543210fedcba9876543210)",
    ].join("\n\n");

    const output = preserveGeneratedConnections(html, markdown);

    expect(output).toContain("/api/pages?notionUrl=https%3A%2F%2Fapp.notion.com%2Fp%2Fws%2FChild");
    expect(output).toContain("Connected Notion pages are preserved");
    expect(output).toContain("Research appendix");
    expect(output).toContain("/api/pages?notionUrl=https%3A%2F%2Fapp.notion.com%2Fp%2Fws%2FAppendix");
    expect(output).toContain('<img src="/assets/pages/page-id/images/demo.png"');
    expect(output).toContain("Product UI demo with the core settlement flow.");
  });

  it("keeps an image description even when Codex already included the image", async () => {
    const { preserveGeneratedConnections } = await import("@/lib/generated-connections");
    const output = preserveGeneratedConnections(
      [
        "<style data-document-to-html></style>",
        "<main class=\"document-html-page wrap\">",
        "<img src=\"/assets/pages/page-id/images/demo.png\" alt=\"Product demo\" />",
        "</main>",
      ].join(""),
      [
        "# Source",
        "![Product demo](/assets/pages/page-id/images/demo.png)",
        "Codex image description: Product UI demo with the core settlement flow.",
      ].join("\n\n"),
    );

    expect(output).toContain("Product UI demo with the core settlement flow.");
  });
});
