import { describe, expect, it } from "vitest";
import { documentFromMarkdown } from "@/lib/document";
import { progressBodyHtml, renderHtmlBody, wrapServedHtml } from "@/lib/render-html";

describe("HTML rendering", () => {
  it("renders document JSON as a body artifact", () => {
    const document = documentFromMarkdown({
      notionUrl: "https://notion.so/test",
      markdown: "# Hello\n\nA paragraph with **bold** text.",
    });

    const body = renderHtmlBody(document);

    expect(body).toContain('data-schema-version="1"');
    expect(body).toContain("<h1>Hello</h1>");
    expect(body).toContain("<strong>bold</strong>");
    expect(body).not.toContain("<html");
  });

  it("injects toolbar in the served shell", () => {
    const html = wrapServedHtml({
      title: "Hello",
      notionUrl: "https://notion.so/test",
      regeneratePath: "/api/pages/abc/regenerate",
      body: "<main>Body</main>",
      pageState: {
        status: "ready",
        generatedAt: new Date(),
      },
    });

    expect(html).toContain("<html");
    expect(html).toContain("Open source Notion page");
    expect(html).toContain("/api/pages/abc/regenerate");
    expect(html).toContain("Regenerate page");
    expect(html).toContain("Regenerate page?");
    expect(html).toContain("data-tooltip=\"Open source Notion page\"");
    expect(html).toContain("data-tooltip=\"Regenerate page\"");
    expect(html).toContain("Fresh");
  });

  it("sets the served shell language to Chinese when the content is Chinese", () => {
    const html = wrapServedHtml({
      title: "硅谷与亚洲早期资本",
      notionUrl: "https://notion.so/test",
      regeneratePath: "/api/pages/abc/regenerate",
      body: "<main><h1>硅谷与亚洲早期资本</h1><p>早期资本正在形成哑铃结构。</p></main>",
      pageState: {
        status: "ready",
        generatedAt: new Date(),
      },
    });

    expect(html).toContain('<html lang="zh-CN">');
  });

  it("keeps the original served language and hides language choices in the toolbar menu", () => {
    const html = wrapServedHtml({
      title: "硅谷与亚洲早期资本",
      notionUrl: "https://notion.so/test",
      regeneratePath: "/api/pages/abc/regenerate",
      languagePath: "/api/pages/abc/language",
      body: "<main><h1>硅谷与亚洲早期资本</h1><p>早期资本正在形成哑铃结构。</p></main>",
      pageState: {
        status: "ready",
        generatedAt: new Date(),
      },
    });

    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain('data-toolbar-menu-open');
    expect(html).toContain('data-language-menu');
    expect(html).toContain('data-language-code="en"');
    expect(html).toContain('data-language-code="zh-CN"');
    expect(html).toContain('action="/api/pages/abc/language"');
    expect(html).toContain('name="language" value="en"');
    expect(html).not.toContain("translate.google.com");
  });

  it("renders images and rewrites Notion links through the generator", () => {
    const document = documentFromMarkdown({
      notionUrl: "https://notion.so/test",
      markdown: [
        "# Hello",
        "![Chart](https://example.com/chart.png)",
        "[Child page](https://app.notion.com/p/workspace/Child-0123456789abcdef0123456789abcdef)",
      ].join("\n\n"),
    });

    const body = renderHtmlBody(document);

    expect(body).toContain('<img src="https://example.com/chart.png"');
    expect(body).toContain("figcaption>Chart</figcaption>");
    expect(body).toContain("/api/pages?notionUrl=");
    expect(body).toContain("Child page</a>");
  });

  it("drops Firecrawl shell noise and renders markdown tables", () => {
    const document = documentFromMarkdown({
      notionUrl: "https://notion.so/test",
      markdown: [
        "# Research",
        "[Skip to content](#main)",
        "| Company | Detail |",
        "| --- | --- |",
        "| [1Money](https://1money.com) | Stablecoin infrastructure |",
      ].join("\n"),
    });

    const body = renderHtmlBody(document);

    expect(body).not.toContain("Skip to content");
    expect(body).toContain("<table>");
    expect(body).toContain("<th>Company</th>");
    expect(body).toContain('<a href="https://1money.com">1Money</a>');
    expect(body).toContain("<td>Stablecoin infrastructure</td>");
  });

  it("renders fenced code blocks without leaking raw backticks", () => {
    const document = documentFromMarkdown({
      notionUrl: "https://notion.so/test",
      markdown: [
        "# SDK Notes",
        "Install with:",
        "```bash",
        "npm install instructor",
        "```",
      ].join("\n"),
    });

    const body = renderHtmlBody(document);

    expect(body).toContain("<pre><code>npm install instructor</code></pre>");
    expect(body).not.toContain("```");
  });

  it("renders generation progress state", () => {
    const body = progressBodyHtml({
      status: "generating",
      generationStep: "Building document JSON",
      generationProgress: 55,
      generationLog: [{
        at: "2026-07-01T00:10:30.000Z",
        status: "generating",
        step: "Firecrawl returned 120 markdown chars",
        progress: 35,
      }],
    });
    const html = wrapServedHtml({
      title: "Generation in flight",
      notionUrl: "https://notion.so/test",
      regeneratePath: "/api/pages/abc/regenerate",
      body,
      pageState: {
        status: "generating",
        generationStep: "Building document JSON",
        generationProgress: 55,
      },
    });

    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain("Building document JSON");
    expect(html).toContain("Firecrawl returned 120 markdown chars");
    expect(html).toContain("nth-log-list");
    expect(html).toContain("55% complete");
    expect(html).toContain("Not generated yet");
    expect(html).not.toContain("Refreshing 55%");
    expect(html).not.toContain('<details class="nth-progress-details">');
    expect(html).not.toContain('<span class="nth-mini-progress"');
    expect(html).not.toContain('<aside class="nth-status-banner"');
  });

  it("renders refresh progress only in the toolbar when cached HTML exists", () => {
    const html = wrapServedHtml({
      title: "Cached",
      notionUrl: "https://notion.so/test",
      regeneratePath: "/api/pages/abc/regenerate",
      body: "<main>Cached copy</main>",
      pageState: {
        status: "generating",
        generationStep: "Publishing cached HTML",
        generationProgress: 90,
        generatedAt: new Date(),
      },
    });

    expect(html).toContain("<main>Cached copy</main>");
    expect(html).toContain("Refreshing 90%");
    expect(html).toContain("Publishing cached HTML");
    expect(html).toContain("nth-progress-panel");
    expect(html).not.toContain('<aside class="nth-status-banner"');
    expect(html).not.toContain("90% complete. This page refreshes every few seconds.");
  });

  it("renders generation log details in the floating toolbar panel", () => {
    const html = wrapServedHtml({
      title: "Cached",
      notionUrl: "https://notion.so/test",
      regeneratePath: "/api/pages/abc/regenerate",
      body: "<main>Cached copy</main>",
      pageState: {
        status: "generating",
        generationStep: "Rendering HTML",
        generationProgress: 75,
        generatedAt: new Date(),
        generationLog: [
          {
            at: "2026-07-01T00:10:19.000Z",
            status: "queued",
            step: "Queued for regeneration",
            progress: 0,
          },
          {
            at: "2026-07-01T00:10:30.000Z",
            status: "generating",
            step: "Rendering HTML",
            progress: 75,
          },
        ],
      },
    });

    expect(html).toContain("nth-log-list");
    expect(html).toContain("Queued for regeneration");
    expect(html).toContain("Rendering HTML");
    expect(html).toContain("75%");
    expect(html).toContain('data-progress-details');
    expect(html).toContain('data-progress-toggle');
  });
});
