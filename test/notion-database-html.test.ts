import { describe, expect, it } from "vitest";
import { renderNotionDatabaseHtmlBody } from "@/lib/notion-database-html";
import type { PublicNotionDatabase } from "@/lib/notion-database";

describe("Notion database HTML rendering", () => {
  it("renders a landing plus every database entry with subpage and source links", () => {
    const html = renderNotionDatabaseHtmlBody(databaseFixture());

    expect(html).toContain("<style data-document-to-html>");
    expect(html).toContain('<main class="document-html-page wrap">');
    expect(html).toContain("All entries");
    expect(html.match(/<tr data-category=/g)).toHaveLength(2);
    expect(html.match(/class="entry-title"/g)).toHaveLength(2);
    expect(html.match(/class="source-link"/g)).toHaveLength(2);
    expect(html).toContain("/api/pages?notionUrl=");
    expect(html).toContain("Notion row");
    expect(html).toContain('<a href="https://alpha.example/docs" target="_blank" rel="noreferrer">docs</a>');
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).not.toContain("[docs](https://alpha.example/docs)");
  });
});

function databaseFixture(): PublicNotionDatabase {
  return {
    pageId: "11111111-1111-1111-1111-111111111111",
    sourceUrl: "https://app.notion.com/p/workspace/Toolbox-11111111111111111111111111111111?v=22222222222222222222222222222222",
    collectionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    viewId: "22222222-2222-2222-2222-222222222222",
    title: "Toolbox",
    schema: {},
    rows: [
      {
        id: "33333333-3333-3333-3333-333333333333",
        compactId: "33333333333333333333333333333333",
        title: "Alpha",
        description: "Docs at [docs](https://alpha.example/docs)",
        productUrl: "https://alpha.example",
        category: "ai",
        createdTime: 1760000000000,
        rowUrl: "https://app.notion.com/p/workspace/Toolbox-11111111111111111111111111111111?v=22222222222222222222222222222222&p=33333333333333333333333333333333&pm=s",
      },
      {
        id: "44444444-4444-4444-4444-444444444444",
        compactId: "44444444444444444444444444444444",
        title: "Beta",
        description: "**Bold** description",
        productUrl: "beta.example/path",
        category: "web",
        createdTime: 1760100000000,
        rowUrl: "https://app.notion.com/p/workspace/Toolbox-11111111111111111111111111111111?v=22222222222222222222222222222222&p=44444444444444444444444444444444&pm=s",
      },
    ],
  };
}
