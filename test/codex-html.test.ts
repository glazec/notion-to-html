import { writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

describe("Codex document-to-html generation", () => {
  it("uses the document-to-html skill prompt and returns a sanitized HTML body", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("CODEX_ACCESS_TOKEN", "token");

    const calls: Array<{ args: string[]; options: { timeout?: number } }> = [];
    const endStdin = vi.fn();
    vi.doMock("node:child_process", () => ({
      execFile: (
        _file: string,
        args: string[],
        options: { timeout?: number },
        callback: (error: Error | null, stdout?: string, stderr?: string) => void,
      ) => {
        calls.push({ args, options });
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
        return { stdin: { end: endStdin } };
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
    expect(calls[0].options.timeout).toBeGreaterThanOrEqual(10 * 60 * 1000);
    expect(body).toContain("data-document-to-html");
    expect(body).toContain("document-html-page wrap");
    expect(body).toContain("<details class=\"x\">");
    expect(body).not.toContain("<script");
    expect(body).not.toContain("```");
    expect(endStdin).toHaveBeenCalledOnce();

    vi.unstubAllEnvs();
  });

  it("tells Codex to keep Chinese source pages in Chinese", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("CODEX_ACCESS_TOKEN", "token");

    let prompt = "";
    vi.doMock("node:child_process", () => ({
      execFile: (
        _file: string,
        args: string[],
        _options: { timeout?: number },
        callback: (error: Error | null, stdout?: string, stderr?: string) => void,
      ) => {
        prompt = args.at(-1) ?? "";
        const outputPath = args[args.indexOf("-o") + 1];
        writeFileSync(outputPath, [
          "<style data-document-to-html>:root { --bg: #fff; }</style>",
          "<main class=\"document-html-page wrap\"><section class=\"hero\"><h1>硅谷与亚洲早期资本</h1></section></main>",
        ].join("\n"));
        callback(null, "", "");
        return { stdin: { end: vi.fn() } };
      },
    }));

    const { generateDocumentHtmlBody } = await import("@/lib/codex-generator");
    await generateDocumentHtmlBody({
      notionUrl: "https://notion.so/test",
      markdown: "# 硅谷与亚洲早期资本\n\n早期资本正在形成哑铃结构。",
    });

    expect(prompt).toContain("Detected source language: Simplified Chinese");
    expect(prompt).toContain("Write the generated page in Simplified Chinese");
    expect(prompt).toContain("Do not translate Chinese source passages into English");

    vi.unstubAllEnvs();
  });

  it("reports a missing Codex binary when Codex credentials are configured", async () => {
    vi.resetModules();
    vi.doUnmock("node:child_process");
    vi.unstubAllEnvs();
    vi.stubEnv("CODEX_ACCESS_TOKEN", "token");
    vi.stubEnv("CODEX_BIN", "missing-codex-binary");

    const { generateDocumentHtmlBody } = await import("@/lib/codex-generator");

    await expect(generateDocumentHtmlBody({
      notionUrl: "https://notion.so/test",
      markdown: "# 1Money",
    })).rejects.toMatchObject({ code: "ENOENT" });

    vi.unstubAllEnvs();
  });

  it("recovers the HTML body from Codex stdout when the output file is missing", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("CODEX_ACCESS_TOKEN", "token");

    vi.doMock("node:child_process", () => ({
      execFile: (
        _file: string,
        _args: string[],
        _options: { timeout?: number },
        callback: (error: Error | null, stdout?: string, stderr?: string) => void,
      ) => {
        callback(null, [
          "status: complete",
          "<style data-document-to-html>:root { --bg: #fff; }</style>",
          "<main class=\"document-html-page wrap\"><section class=\"hero\"><h1>1Money</h1></section></main>",
          "extra runner text",
        ].join("\n"), "");
      },
    }));

    const { generateDocumentHtmlBody } = await import("@/lib/codex-generator");
    const body = await generateDocumentHtmlBody({
      notionUrl: "https://notion.so/test",
      markdown: "# 1Money\n\nStablecoin infrastructure.",
    });

    expect(body).toContain("data-document-to-html");
    expect(body).toContain("document-html-page wrap");
    expect(body).not.toContain("extra runner text");

    vi.unstubAllEnvs();
  });

  it("reports a clear error when Codex completes without an HTML artifact", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("CODEX_ACCESS_TOKEN", "token");

    vi.doMock("node:child_process", () => ({
      execFile: (
        _file: string,
        _args: string[],
        _options: { timeout?: number },
        callback: (error: Error | null, stdout?: string, stderr?: string) => void,
      ) => {
        callback(null, "", "finished without final message");
      },
    }));

    const { generateDocumentHtmlBody } = await import("@/lib/codex-generator");

    await expect(generateDocumentHtmlBody({
      notionUrl: "https://notion.so/test",
      markdown: "# 1Money",
    })).rejects.toThrow("Codex did not produce an HTML artifact");

    vi.unstubAllEnvs();
  });
});
