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

  it("omits Notion emoji assets from fallback visual references", async () => {
    const { preserveGeneratedConnections } = await import("@/lib/generated-connections");
    const output = preserveGeneratedConnections(
      '<style data-document-to-html></style><main class="document-html-page wrap"></main>',
      [
        "# Kiln",
        "![🔥 Page icon](/assets/pages/page-id/images/fire.svg)",
        "![Image 1](/assets/pages/page-id/images/emoji-sprite.webp)",
        "![Operating chart](/assets/pages/page-id/images/chart.png)",
        "### Image 1: 🔥 Page icon",
        "Local image: /assets/pages/page-id/images/fire.svg",
        "Original image: https://notion-emojis.s3-us-west-2.amazonaws.com/prod/svg-twitter/1f525.svg",
        "Codex image description: 🔥 Page icon",
        "### Image 2: Image 1",
        "Local image: /assets/pages/page-id/images/emoji-sprite.webp",
        "Original image: https://iosgvc.notion.site/images/emoji/twitter-emoji-spritesheet-32.0e67dbfc.webp",
        "Codex image description: Image 1",
        "### Image 3: Operating chart",
        "Local image: /assets/pages/page-id/images/chart.png",
        "Original image: https://example.com/kiln-chart.png",
        "Codex image description: A chart showing Kiln operating performance.",
      ].join("\n"),
    );

    expect(output).not.toContain("🔥 Page icon");
    expect(output).not.toContain("emoji-sprite.webp");
    expect(output).toContain("Operating chart");
    expect(output).toContain("A chart showing Kiln operating performance.");
  });

  it("omits Notion user avatars from fallback visual references", async () => {
    const { preserveGeneratedConnections } = await import("@/lib/generated-connections");
    const output = preserveGeneratedConnections(
      '<style data-document-to-html></style><main class="document-html-page wrap"></main>',
      [
        "# Quant Platform Chinese",
        "### Image 1: YiPing Lu",
        "Local image: /assets/pages/page-id/images/yiping.png",
        "Original image: https://example.com/yiping.png",
        "Codex image description: A purple square profile avatar displaying a white capital Y, representing YiPing Lu.",
      ].join("\n"),
    );

    expect(output).not.toContain("visual-assets");
    expect(output).not.toContain("yiping.png");
    expect(output).not.toContain("profile avatar");
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
