import { writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

describe("Codex document-to-html generation", () => {
  it("uses the document-to-html skill prompt and returns a sanitized HTML body", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("CODEX_ACCESS_TOKEN", "token");

    const calls: Array<{ args: string[] }> = [];
    vi.doMock("node:child_process", () => ({
      execFile: (
        _file: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout?: string, stderr?: string) => void,
      ) => {
        calls.push({ args });
        const outputPath = args[args.indexOf("-o") + 1];
        writeFileSync(outputPath, [
          "```html",
          "<style data-document-to-html>",
          ":root { --bg: oklch(.987 .005 78); --accent: oklch(.575 .185 33); }",
          "body { background: var(--bg); }",
          "</style>",
          "<main class=\"document-html-page wrap\">",
          "<section class=\"hero\"><div class=\"brand\">IOSG VENTURES · NOTION</div><h1>1Money <span class=\"hl\">stablecoin stack</span></h1></section>",
          "<details class=\"x\"><summary><span class=\"t\">Why it matters</span></summary><div class=\"body\">Depth</div></details>",
          "<script>alert('bad')</script>",
          "</main>",
          "```",
        ].join("\n"));
        callback(null, "", "");
      },
    }));

    const { generateDocumentHtmlBody } = await import("@/lib/codex-generator");
    const body = await generateDocumentHtmlBody({
      notionUrl: "https://notion.so/test",
      markdown: "# 1Money\n\nStablecoin infrastructure.",
    });

    const prompt = calls[0].args.at(-1) ?? "";
    expect(prompt).toContain("document-to-html");
    expect(prompt).toContain("warm paper");
    expect(prompt).toContain("terracotta");
    expect(prompt).toContain("details class=\"x\"");
    expect(body).toContain("data-document-to-html");
    expect(body).toContain("document-html-page wrap");
    expect(body).toContain("<details class=\"x\">");
    expect(body).not.toContain("<script");
    expect(body).not.toContain("```");

    vi.unstubAllEnvs();
  });
});
