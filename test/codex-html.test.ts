import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

describe("Codex document-to-html generation", () => {
  it("uses the document-to-html skill prompt and returns a sanitized HTML body", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    vi.stubEnv("CODEX_ACCESS_TOKEN", "legacy-token");
    vi.stubEnv("DATABASE_URL", "postgres://user:password@example.com/app");
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-secret");
    vi.stubEnv("NOTION_API_KEY", "ntn-secret");
    vi.stubEnv("SECRET_ACCESS_KEY", "bucket-secret");

    const calls: Array<{ args: string[]; options: { timeout?: number; env?: NodeJS.ProcessEnv } }> = [];
    const endStdin = vi.fn();
    vi.doMock("node:child_process", () => ({
      execFile: (
        _file: string,
        args: string[],
        options: { timeout?: number; env?: NodeJS.ProcessEnv },
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
          "<img src=\"https://example.com/iosg-logo.png\" alt=\"IOSG logo\">",
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
    expect(prompt).toContain("Kami's restrained editorial language");
    expect(prompt).toContain("ink blue #1B365D");
    expect(prompt).toContain("Do not include the IOSG name, IOSG logo, IOSG wordmark");
    expect(prompt).toContain("details class=\"x\"");
    expect(prompt).toContain("Contrast checklist");
    expect(prompt).toContain("4.5:1");
    expect(prompt).toContain("3:1");
    expect(prompt).toContain("computed foreground and effective background");
    expect(prompt).toContain("omit emoji from visible labels");
    expect(prompt).not.toMatch(/font-size:\s*[^;]*vw/i);
    expect(prompt).not.toMatch(/letter-spacing:\s*-/i);
    expect(calls[0].args).toContain("--model");
    expect(calls[0].args[calls[0].args.indexOf("--model") + 1]).toBe("cx/gpt-5.6-terra-medium");
    expect(calls[0].args).toContain("model_provider=\"inevitable_gateway\"");
    expect(calls[0].args).toContain(
      'model_providers.inevitable_gateway.base_url="https://aigateway.inevitable.tech/v1"',
    );
    expect(calls[0].args).toContain('model_providers.inevitable_gateway.env_key="AI_GATEWAY_API_KEY"');
    expect(calls[0].args).toContain('model_providers.inevitable_gateway.wire_api="responses"');
    expect(calls[0].options.timeout).toBeGreaterThanOrEqual(10 * 60 * 1000);
    expect(calls[0].options.env?.AI_GATEWAY_API_KEY).toBe("gateway-key");
    expect(calls[0].options.env?.CODEX_ACCESS_TOKEN).toBeUndefined();
    expect(calls[0].options.env?.CODEX_HOME).toContain("notion-to-html-codex-");
    expect(calls[0].options.env?.HOME).toBe(calls[0].options.env?.CODEX_HOME);
    expect(calls[0].options.env?.HOME).not.toBe(process.env.HOME);
    expect(calls[0].options.env?.DATABASE_URL).toBeUndefined();
    expect(calls[0].options.env?.FIRECRAWL_API_KEY).toBeUndefined();
    expect(calls[0].options.env?.NOTION_API_KEY).toBeUndefined();
    expect(calls[0].options.env?.SECRET_ACCESS_KEY).toBeUndefined();
    expect(body).toContain("data-document-to-html");
    expect(body).toContain("document-html-page wrap");
    expect(body).toContain("<details class=\"x\">");
    expect(body).not.toContain("<script");
    expect(body).not.toContain("iosg-logo.png");
    expect(body).not.toContain("alt=\"IOSG logo\"");
    expect(body).not.toContain("```");
    expect(endStdin).toHaveBeenCalledOnce();

    vi.unstubAllEnvs();
  });

  it("removes encoded script URLs and SVG payloads from Codex HTML", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("CODEX_ACCESS_TOKEN", "token");

    vi.doMock("node:child_process", () => ({
      execFile: (
        _file: string,
        args: string[],
        _options: { timeout?: number },
        callback: (error: Error | null, stdout?: string, stderr?: string) => void,
      ) => {
        const outputPath = args[args.indexOf("-o") + 1];
        writeFileSync(outputPath, [
          "<style data-document-to-html>",
          ":root { --bg: #fff; }",
          ".x { background-image: url(javascript:alert(1)); color: red; }",
          "</style>",
          "<main class=\"document-html-page wrap\">",
          "<a href=\"java&#115;cript:alert(1)\" onclick=\"bad()\">Bad link</a>",
          "<img src=\"/assets/pages/page-id/images/demo.png\" onerror=\"bad()\" alt=\"Demo\">",
          "<svg onload=\"bad()\"><script>alert(1)</script></svg>",
          "</main>",
        ].join("\n"));
        callback(null, "", "");
        return { stdin: { end: vi.fn() } };
      },
    }));

    const { generateDocumentHtmlBody } = await import("@/lib/codex-generator");
    const body = await generateDocumentHtmlBody({
      notionUrl: "https://notion.so/test",
      markdown: "# 1Money\n\n![Demo](/assets/pages/page-id/images/demo.png)",
    });

    expect(body).toContain("document-html-page wrap");
    expect(body).toContain("<img");
    expect(body).not.toContain("java&#115;cript");
    expect(body).not.toContain("javascript:");
    expect(body).not.toContain("onclick");
    expect(body).not.toContain("onerror");
    expect(body).not.toContain("<svg");
    expect(body).not.toContain("<script");

    vi.unstubAllEnvs();
  });

  it("uses low reasoning for narrow image descriptions", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    let invocationArgs: string[] = [];

    vi.doMock("node:child_process", () => ({
      execFile: (
        _file: string,
        args: string[],
        _options: { timeout?: number },
        callback: (error: Error | null, stdout?: string, stderr?: string) => void,
      ) => {
        invocationArgs = args;
        const outputPath = args[args.indexOf("-o") + 1];
        writeFileSync(outputPath, "A settlement dashboard showing validator status.");
        callback(null, "", "");
        return { stdin: { end: vi.fn() } };
      },
    }));

    const { describeImageAsset } = await import("@/lib/codex-generator");
    const description = await describeImageAsset({
      imagePath: "/tmp/dashboard.png",
      altText: "Settlement dashboard",
      sourceUrl: "https://example.com/dashboard.png",
    });

    expect(invocationArgs[invocationArgs.indexOf("--model") + 1]).toBe("cx/gpt-5.6-terra-low");
    expect(description).toBe("A settlement dashboard showing validator status.");
    vi.unstubAllEnvs();
  });

  it("stores generated Mermaid PNG images and rewrites their HTML references", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("CODEX_ACCESS_TOKEN", "token");
    const putBinaryObject = vi.fn();
    let prompt = "";

    vi.doMock("@/lib/bucket", () => ({ putBinaryObject }));
    vi.doMock("node:child_process", () => ({
      execFile: (
        _file: string,
        args: string[],
        options: { cwd?: string },
        callback: (error: Error | null, stdout?: string, stderr?: string) => void,
      ) => {
        prompt = args.at(-1) ?? "";
        const cwd = options.cwd ?? "";
        const outputPath = args[args.indexOf("-o") + 1];
        mkdirSync(`${cwd}/generated-assets`, { recursive: true });
        writeFileSync(
          `${cwd}/generated-assets/architecture.png`,
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]),
        );
        writeFileSync(outputPath, [
          "<style data-document-to-html>:root { --bg: #fff; }</style>",
          "<main class=\"document-html-page wrap\">",
          "<h1>Quant Platform</h1>",
          "<figure class=\"mermaid-chart\"><img src=\"generated-assets/architecture.png\" alt=\"External API to published version\"></figure>",
          "</main>",
        ].join("\n"));
        callback(null, "", "");
        return { stdin: { end: vi.fn() } };
      },
    }));

    const { generateDocumentHtmlBody } = await import("@/lib/codex-generator");
    const body = await generateDocumentHtmlBody({
      notionUrl: "https://notion.so/test",
      pageId: "page-id",
      markdown: [
        "# Quant Platform",
        "```mermaid",
        "flowchart LR",
        "  API --> Published",
        "```",
      ].join("\n"),
    });

    expect(prompt).toContain("Source Mermaid blocks: 1");
    expect(prompt).toContain("Treat Mermaid and every concept diagram as images");
    expect(putBinaryObject).toHaveBeenCalledWith(
      expect.stringMatching(/^assets\/pages\/page-id\/generated\/[a-f0-9]{32}\.png$/),
      expect.any(Uint8Array),
      "image/png",
    );
    expect(body).toMatch(/<img src="\/assets\/pages\/page-id\/generated\/[a-f0-9]{32}\.png"/);
    expect(body).not.toContain("generated-assets/");
    expect(body).not.toContain("<svg");

    vi.doUnmock("@/lib/bucket");
    vi.unstubAllEnvs();
  });

  it("rejects generated HTML that flattens a Mermaid block instead of rendering an image", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("CODEX_ACCESS_TOKEN", "token");

    vi.doMock("node:child_process", () => ({
      execFile: (
        _file: string,
        args: string[],
        _options: { cwd?: string },
        callback: (error: Error | null, stdout?: string, stderr?: string) => void,
      ) => {
        const outputPath = args[args.indexOf("-o") + 1];
        writeFileSync(outputPath, [
          "<style data-document-to-html>:root { --bg: #fff; }</style>",
          "<main class=\"document-html-page wrap\"><h1>Quant Platform</h1><p>API Published</p></main>",
        ].join("\n"));
        callback(null, "", "");
        return { stdin: { end: vi.fn() } };
      },
    }));

    const { generateDocumentHtmlBody } = await import("@/lib/codex-generator");
    await expect(generateDocumentHtmlBody({
      notionUrl: "https://notion.so/test",
      pageId: "page-id",
      markdown: "# Quant Platform\n\n```mermaid\nflowchart LR\n  API --> Published\n```",
    })).rejects.toThrow("Codex rendered 0 diagram images for 1 Mermaid blocks");

    vi.unstubAllEnvs();
  });

  it("falls back to source rendering when Codex drops database row content", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("CODEX_ACCESS_TOKEN", "token");

    vi.doMock("node:child_process", () => ({
      execFile: (
        _file: string,
        args: string[],
        _options: { timeout?: number },
        callback: (error: Error | null, stdout?: string, stderr?: string) => void,
      ) => {
        const outputPath = args[args.indexOf("-o") + 1];
        writeFileSync(outputPath, [
          "<style data-document-to-html>:root { --bg: #fff; }</style>",
          "<main class=\"document-html-page wrap\">",
          "<section class=\"hero\"><h1>Toolbox</h1><p>The available source material is limited.</p></section>",
          "</main>",
        ].join("\n"));
        callback(null, "", "");
        return { stdin: { end: vi.fn() } };
      },
    }));

    const { generateDocumentHtmlBody } = await import("@/lib/codex-generator");
    const body = await generateDocumentHtmlBody({
      notionUrl: "https://app.notion.com/p/homeless20/8ddb379e60aa4deb8ef4f730fe96dfba",
      markdown: [
        "# Toolbox",
        "",
        "Table",
        "",
        "Group",
        "",
        "Name",
        "",
        "Description",
        "",
        "URL",
        "",
        "Category",
        "",
        "Created time",
        "",
        "iroh",
        "",
        "拨号密钥而非 IP，给你的 App 装上点对点连接的网络库",
        "",
        "[iroh.computer](https://www.iroh.computer/)",
        "",
        "web",
        "",
        "June 30, 2026 11:20 PM",
        "",
        "Collect UI",
        "",
        "每日更新的 UI 设计灵感集合，适合快速寻找界面参考。",
        "",
        "[collectui.com/](https://collectui.com/)",
        "",
        "design",
        "",
        "June 24, 2026 6:20 PM",
      ].join("\n"),
    });

    expect(body).toContain("iroh");
    expect(body).toContain("Collect UI");
    expect(body).toContain("拨号密钥");
    expect(body).not.toContain("available source material is limited");

    vi.unstubAllEnvs();
  });

  it("passes Notion database generation rules to Codex for table exports", async () => {
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
          "<main class=\"document-html-page wrap\"><section class=\"hero\"><h1>Toolbox</h1></section></main>",
        ].join("\n"));
        callback(null, "", "");
        return { stdin: { end: vi.fn() } };
      },
    }));

    const { generateDocumentHtmlBody } = await import("@/lib/codex-generator");
    await generateDocumentHtmlBody({
      notionUrl: "https://app.notion.com/p/homeless20/8ddb379e60aa4deb8ef4f730fe96dfba?v=1ede54c010fe47f6b0fc1ee1b5d31fc7",
      markdown: [
        "# Toolbox",
        "",
        "Table",
        "",
        "Name",
        "",
        "Description",
        "",
        "URL",
        "",
        "Category",
        "",
        "Created time",
        "",
        "iroh",
        "",
        "拨号密钥而非 IP，给你的 App 装上点对点连接的网络库",
        "",
        "[iroh.computer](https://www.iroh.computer/)",
        "",
        "web",
        "",
        "June 30, 2026 11:20 PM",
      ].join("\n"),
    });

    expect(prompt).toContain("Notion database/table generation requirements:");
    expect(prompt).toContain("Keep the landing hero");
    expect(prompt).toContain("Render every available database row");
    expect(prompt).toContain("Row title links should point to generated HTML subpage routes");
    expect(prompt).toContain("Notion row");
    expect(prompt).toContain("Do not classify Notion icons, emoji assets, /icons/, /images/, or same-page anchors as linked subpages");

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

  it("tells Codex to use the selected language instead of auto detecting source language", async () => {
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
          "<main class=\"document-html-page wrap\"><section class=\"hero\"><h1>Silicon Valley and Asian early capital</h1></section></main>",
        ].join("\n"));
        callback(null, "", "");
        return { stdin: { end: vi.fn() } };
      },
    }));

    const { generateDocumentHtmlBody } = await import("@/lib/codex-generator");
    await generateDocumentHtmlBody({
      notionUrl: "https://notion.so/test",
      markdown: "# 硅谷与亚洲早期资本\n\n早期资本正在形成哑铃结构。",
      targetLanguage: "en",
    });

    expect(prompt).toContain("Selected output language: English.");
    expect(prompt).toContain("Write the generated page in English");
    expect(prompt).not.toContain("Detected source language: Simplified Chinese");

    vi.unstubAllEnvs();
  });

  it("does not force Chinese when mixed source has only 20 percent or less Chinese text", async () => {
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
          "<main class=\"document-html-page wrap\"><section class=\"hero\"><h1>Mixed RWA note</h1></section></main>",
        ].join("\n"));
        callback(null, "", "");
        return { stdin: { end: vi.fn() } };
      },
    }));

    const { generateDocumentHtmlBody } = await import("@/lib/codex-generator");
    await generateDocumentHtmlBody({
      notionUrl: "https://notion.so/test",
      markdown: [
        "# Mixed RWA note",
        "资产质量分发渠道市场机会风险高",
        "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz",
      ].join("\n\n"),
    });

    expect(prompt).not.toContain("Detected source language: Simplified Chinese");
    expect(prompt).toContain("Preserve the dominant source language");

    vi.unstubAllEnvs();
  });

  it("forces Chinese when mixed source has more than 20 percent Chinese text", async () => {
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
          "<main class=\"document-html-page wrap\"><section class=\"hero\"><h1>RWA 中文笔记</h1></section></main>",
        ].join("\n"));
        callback(null, "", "");
        return { stdin: { end: vi.fn() } };
      },
    }));

    const { generateDocumentHtmlBody } = await import("@/lib/codex-generator");
    await generateDocumentHtmlBody({
      notionUrl: "https://notion.so/test",
      markdown: [
        "# RWA 中文笔记",
        "资产质量分发渠道市场机会风险高收益合规流动性",
        "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz",
      ].join("\n\n"),
    });

    expect(prompt).toContain("Detected source language: Simplified Chinese");
    expect(prompt).toContain("Write the generated page in Simplified Chinese");

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
