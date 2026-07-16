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

  it("keeps links to the current Notion source external instead of routing back to the same generated page", async () => {
    const { preserveGeneratedConnections } = await import("@/lib/generated-connections");
    const sourceUrl = "https://iosgvc.notion.site/Potential-Skills-Consolidation-396f0ada243c80869444d8f311c7a296";
    const childUrl = "https://iosgvc.notion.site/Research-Appendix-fedcba9876543210fedcba9876543210";
    const html = [
      "<style data-document-to-html></style>",
      "<main class=\"document-html-page wrap\">",
      `<a href="${sourceUrl}">View details</a>`,
      `<a href="${childUrl}">Research appendix</a>`,
      "</main>",
    ].join("");

    const output = preserveGeneratedConnections(html, "# Source", sourceUrl);

    expect(output).toContain(`href="${sourceUrl}"`);
    expect(output).not.toContain(`/api/pages?notionUrl=${encodeURIComponent(sourceUrl)}`);
    expect(output).toContain(`/api/pages?notionUrl=${encodeURIComponent(childUrl)}`);
  });

  it("omits emoji from fallback reference labels", async () => {
    const { preserveGeneratedConnections } = await import("@/lib/generated-connections");
    const childUrl = "https://iosgvc.notion.site/Research-Appendix-fedcba9876543210fedcba9876543210";
    const output = preserveGeneratedConnections(
      '<style data-document-to-html></style><main class="document-html-page wrap"></main>',
      `# Source\n\n- [📚 Research appendix 🔬](${childUrl})`,
    );

    expect(output).toContain(">Research appendix</a>");
    expect(output).not.toContain("📚");
    expect(output).not.toContain("🔬");
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

  it("does not treat Notion image assets or same-page anchors as linked pages", async () => {
    const { preserveGeneratedConnections } = await import("@/lib/generated-connections");
    const html = [
      "<style data-document-to-html></style>",
      "<main class=\"document-html-page wrap\">",
      "<section><p>Generated body</p></section>",
      "</main>",
    ].join("");
    const markdown = [
      "# Toolbox",
      "[Skip to content](https://app.notion.com/p/homeless20/8ddb379e60aa4deb8ef4f730fe96dfba?v=1ede54c010fe47f6b0fc1ee1b5d31fc7#main)",
      "![Image 1](https://app.notion.com/icons/link_gray.svg?mode=light)",
      "![Image 2](https://app.notion.com/images/emoji/twitter-emoji-spritesheet-32.0e67dbfc.webp)",
    ].join("\n\n");

    const output = preserveGeneratedConnections(html, markdown);

    expect(output).not.toContain("Connected Notion pages are preserved");
    expect(output).not.toContain("/api/pages?notionUrl=https%3A%2F%2Fapp.notion.com%2Ficons");
    expect(output).not.toContain("Skip to content");
  });
});
