import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SAMPLE_PATH = "public/samples/8ddb379e60aa4deb8ef4f730fe96dfba.html";

function visibleHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/ data-search="[^"]*"/g, "");
}

describe("database sample HTML", () => {
  it("keeps the database sample complete and free of raw markdown artifacts", () => {
    const html = readFileSync(SAMPLE_PATH, "utf8");
    const visible = visibleHtml(html);

    expect(html).toContain("<style data-document-to-html>");
    expect(html).toContain('<main class="document-html-page wrap">');
    expect(html.match(/<tr data-category=/g)).toHaveLength(384);
    expect(html.match(/class="entry-title" href="https:\/\/notion-to-html-production\.up\.railway\.app\/api\/pages\?notionUrl=/g)).toHaveLength(384);
    expect(html.match(/class="source-link"/g)).toHaveLength(384);
    expect(visible).not.toMatch(/\[[^\]]+\]\(https?:\/\/[^)]+\)/);
    expect(visible).not.toContain("```");
  });

  it("uses stable document-to-html typography without viewport font scaling or negative tracking", () => {
    const html = readFileSync(SAMPLE_PATH, "utf8");
    const css = html.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? "";

    expect(css).not.toMatch(/font-size:\s*[^;]*vw/i);
    expect(css).not.toMatch(/letter-spacing:\s*-/i);
  });
});
