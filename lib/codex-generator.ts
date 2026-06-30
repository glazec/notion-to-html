import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { documentFromMarkdown, parseDocumentJson, type DocumentHtmlJson } from "@/lib/document";
import { optionalEnv } from "@/lib/env";
import { renderHtmlBody } from "@/lib/render-html";

const execFileAsync = promisify(execFile);

const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    schema_version: { type: "number", const: 1 },
    title: { type: "string" },
    notionUrl: { type: "string" },
    theme: { type: "string", const: "light" },
    sections: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { enum: ["hero", "content"] },
          heading: { type: "string" },
          body: { type: "string" },
          blocks: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                type: { enum: ["paragraph", "heading", "list_item", "quote", "code", "image", "table"] },
                text: { type: "string" },
                level: { type: "number" },
                url: { type: "string" },
                alt: { type: "string" },
                rows: {
                  type: "array",
                  items: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
              required: ["type"],
            },
          },
        },
        required: ["type"],
      },
    },
  },
  required: ["schema_version", "title", "notionUrl", "theme", "sections"],
};

export async function generateDocumentJson(input: {
  markdown: string;
  notionUrl: string;
}): Promise<DocumentHtmlJson> {
  if (shouldUseCodex()) {
    try {
      return await generateWithCodex(input);
    } catch (error) {
      if (!isMissingCodexBinaryError(error)) {
        throw error;
      }
    }
  }

  return documentFromMarkdown(input);
}

export async function generateDocumentHtmlBody(input: {
  markdown: string;
  notionUrl: string;
}): Promise<string> {
  if (shouldUseCodex()) {
    try {
      return await generateHtmlWithCodex(input);
    } catch (error) {
      if (!isMissingCodexBinaryError(error)) {
        throw error;
      }
    }
  }

  return renderHtmlBody(documentFromMarkdown(input));
}

function isMissingCodexBinaryError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function shouldUseCodex(): boolean {
  if (optionalEnv("CODEX_GENERATION_ENABLED") === "false") return false;
  return Boolean(
    optionalEnv("CODEX_ACCESS_TOKEN") ||
      optionalEnv("CODEX_AUTH_JSON") ||
      optionalEnv("CODEX_AUTH_JSON_BASE64"),
  );
}

async function generateWithCodex(input: {
  markdown: string;
  notionUrl: string;
}): Promise<DocumentHtmlJson> {
  const dir = await mkdtemp(join(tmpdir(), "notion-to-html-codex-"));
  const markdownPath = join(dir, "notion.md");
  const schemaPath = join(dir, "schema.json");
  const outputPath = join(dir, "document.json");
  const codexBin = optionalEnv("CODEX_BIN") ?? "codex";
  const authEnv = await prepareCodexAuthEnv(dir);

  try {
    await writeFile(markdownPath, input.markdown, "utf8");
    await writeFile(schemaPath, JSON.stringify(outputSchema, null, 2), "utf8");

    const prompt = [
      "Convert notion.md into document-to-html JSON for a light theme HTML page.",
      "Use the source URL exactly:",
      input.notionUrl,
      "Keep the output factual. Do not invent claims that are not in the markdown.",
      "Use schema_version 1. Use sections with a hero and content blocks.",
      "Preserve markdown images as image blocks with url and alt.",
      "Preserve markdown tables as table blocks with rows, including the header as the first row.",
      "Return only schema-conforming JSON.",
    ].join("\n");

    await execFileAsync(
      codexBin,
      [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "--output-schema",
        schemaPath,
        "-o",
        outputPath,
        prompt,
      ],
      {
        cwd: dir,
        timeout: 180_000,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          ...authEnv,
        },
      },
    );

    const raw = await readFile(outputPath, "utf8");
    return parseDocumentJson(JSON.parse(raw));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function generateHtmlWithCodex(input: {
  markdown: string;
  notionUrl: string;
}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "notion-to-html-codex-"));
  const markdownPath = join(dir, "notion.md");
  const outputPath = join(dir, "page.html");
  const codexBin = optionalEnv("CODEX_BIN") ?? "codex";
  const authEnv = await prepareCodexAuthEnv(dir);

  try {
    await writeFile(markdownPath, input.markdown, "utf8");

    await execFileAsync(
      codexBin,
      [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "-o",
        outputPath,
        documentToHtmlPrompt(input.notionUrl),
      ],
      {
        cwd: dir,
        timeout: 300_000,
        maxBuffer: 20 * 1024 * 1024,
        env: {
          ...process.env,
          ...authEnv,
        },
      },
    );

    const raw = await readFile(outputPath, "utf8");
    return sanitizeGeneratedHtml(raw);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function documentToHtmlPrompt(notionUrl: string): string {
  return [
    "Use the document-to-html skill to convert notion.md into a polished HTML page.",
    "Source URL:",
    notionUrl,
    "",
    "Output contract:",
    "- Return only HTML. No markdown fences, explanation, JSON, or comments.",
    "- Return a body artifact for an existing app shell: include one <style data-document-to-html> tag and one <main class=\"document-html-page wrap\"> root.",
    "- Do not include <!doctype>, <html>, <head>, <body>, <script>, iframe, object, embed, external CSS, external JS, or CDN fonts.",
    "- Preserve public image URLs as <img> when useful. Preserve source links with normal <a href> links.",
    "- Use native <details class=\"x\"> rows for depth. The page should be skimmable first and expandable second.",
    "",
    "Document-to-html design language:",
    "- warm paper background, terracotta accent, warm near-black ink.",
    "- Archivo-style sans stack for prose and headings, JetBrains Mono-style stack for section labels, tags, KPI values, and table heads.",
    "- Section labels use the format 01 · THESIS, 02 · PRODUCT, 03 · TRACTION, 04 · RISKS or similar.",
    "- Use 3 to 5 sections. Put surface claims in hero, KPI rows, cards, charts, or visible summaries. Put reasoning in <details class=\"x\"> bodies.",
    "- Prefer assertion headings over labels. Example: \"Licenses are the moat\", not \"Licensing\".",
    "- Use one terracotta focal element per card or chart. Do not make the whole page orange.",
    "- Cut internal notes, self-coaching, QA prompts, and sensitive deal terms unless the source clearly frames them as public-facing.",
    "",
    "Required CSS base and components to include inside <style data-document-to-html>:",
    documentToHtmlCss(),
    "",
    "Build a complete page from notion.md. If the document has quantitative content, use KPI cards, a small chart, or a table. If it has a mechanism, use a simple token-driven SVG concept diagram. Every major claim should have an expandable detail row.",
  ].join("\n");
}

function documentToHtmlCss(): string {
  return `
:root {
  --bg: oklch(.987 .005 78); --surface: oklch(.967 .006 78); --surface2: oklch(.945 .008 78);
  --border: oklch(.885 .008 72); --border-strong: oklch(.80 .010 72);
  --text: oklch(.255 .013 60); --text-soft: oklch(.435 .012 62); --muted: oklch(.58 .010 62);
  --accent: oklch(.575 .185 33); --accent-ink: oklch(.48 .19 33); --accent-soft: oklch(.955 .035 44);
  --good: oklch(.55 .12 150); --good-soft: oklch(.95 .04 150);
  --warn: oklch(.60 .115 72); --warn-soft: oklch(.955 .045 80);
  --mono: "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace;
  --sans: "Archivo", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Helvetica Neue", sans-serif;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { background: var(--bg); color: var(--text); font-family: var(--sans); line-height: 1.7; -webkit-font-smoothing: antialiased; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 64px 40px 80px; }
.hero { padding: 48px 0 56px; border-bottom: 1px solid var(--text); }
.brand { font-family: var(--mono); font-size: 12px; letter-spacing: .08em; color: var(--accent-ink); font-weight: 600; text-transform: uppercase; margin-bottom: 24px; }
h1 { font-size: clamp(34px, 5vw, 54px); line-height: 1.08; font-weight: 700; letter-spacing: -.02em; margin-bottom: 20px; }
h1 .hl { color: var(--accent); }
.hero-tagline { font-size: clamp(17px, 2vw, 21px); color: var(--text-soft); max-width: 760px; line-height: 1.5; }
.hero-tagline b { color: var(--accent-ink); font-weight: 600; }
section { padding: 56px 0; border-bottom: 1px solid var(--border); }
.shead { display: flex; align-items: baseline; gap: 14px; margin-bottom: 14px; }
.sec-label { font-family: var(--mono); font-size: 12.5px; letter-spacing: .06em; color: var(--accent-ink); font-weight: 700; text-transform: uppercase; }
h2 { font-size: clamp(24px, 3vw, 32px); font-weight: 700; letter-spacing: -.01em; }
.lede { font-size: 17px; color: var(--text-soft); max-width: 820px; margin-bottom: 36px; }
.lede b { color: var(--text); font-weight: 600; }
a { color: var(--accent-ink); text-decoration: none; }
.story { background: var(--surface); border-left: 3px solid var(--accent); padding: 28px 32px; border-radius: 0 12px 12px 0; margin-bottom: 36px; font-size: 16.5px; color: var(--text-soft); line-height: 1.7; }
.story b { color: var(--accent-ink); font-weight: 600; }
.kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 18px; margin-bottom: 24px; }
.kpi { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 22px; text-align: center; }
.kpi.focal { border-color: var(--accent); }
.kpi .n { font-family: var(--mono); font-size: 34px; font-weight: 700; letter-spacing: -.02em; color: var(--text); line-height: 1.1; font-variant-numeric: tabular-nums; }
.kpi.focal .n { color: var(--accent-ink); }
.kpi .l { font-size: 12.5px; color: var(--muted); margin-top: 6px; }
.geo-grid, .dir-grid, .edge-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-bottom: 28px; }
.dir-grid { grid-template-columns: 1fr 1fr; }
.geo, .dir, .edge, .chart-box, .diagram-box { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 26px 24px; }
.geo.hot, .kpi.focal { border-color: var(--accent); background: linear-gradient(180deg, var(--accent-soft), var(--surface)); }
.tag, .pill { display: inline-block; font-family: var(--mono); font-size: 11px; letter-spacing: .06em; padding: 4px 10px; border-radius: 99px; margin: 2px 4px 14px 0; font-weight: 600; text-transform: uppercase; background: var(--surface2); color: var(--muted); }
.tag.open, .pill.f { background: var(--accent); border-color: var(--accent); color: #fff; }
.geo h3, .dir h3, .edge h3 { font-size: 20px; font-weight: 700; letter-spacing: -.01em; margin-bottom: 8px; }
.geo p, .dir p, .edge p { font-size: 14.5px; color: var(--text-soft); }
.geo p b, .dir p b, .edge p b { color: var(--text); font-weight: 600; }
.punch { font-size: 22px; font-weight: 700; letter-spacing: -.01em; text-align: center; padding: 28px; background: var(--surface2); border-radius: 12px; line-height: 1.4; }
.punch b { color: var(--accent-ink); }
.expand-hint { font-family: var(--mono); font-size: 12px; color: var(--muted); margin-bottom: 12px; text-transform: uppercase; letter-spacing: .04em; }
details.x { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; margin: 10px 0; overflow: hidden; transition: border-color .2s; }
details.x:hover { border-color: var(--border-strong); }
details.x[open] { border-color: var(--accent); }
details.x > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 14px; padding: 15px 20px; user-select: none; }
details.x > summary::-webkit-details-marker { display: none; }
details.x > summary .chev { flex: none; width: 22px; height: 22px; border-radius: 6px; background: var(--surface2); display: grid; place-items: center; transition: transform .2s cubic-bezier(.22,1,.36,1); }
details.x[open] > summary .chev { transform: rotate(90deg); background: var(--accent-soft); }
details.x > summary .t { font-weight: 600; font-size: 15px; }
details.x > summary .sub { font-size: 13px; color: var(--muted); margin-top: 1px; }
details.x > summary .meta { margin-left: auto; flex: none; font-family: var(--mono); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); background: var(--surface2); padding: 6px 10px; border-radius: 5px; }
details.x .body { padding: 6px 20px 22px 56px; font-size: 15.5px; line-height: 1.75; color: var(--text-soft); max-width: 78ch; overflow-wrap: anywhere; }
.meta.good { background: var(--good-soft); color: var(--good); }
.meta.warn { background: var(--warn-soft); color: var(--warn); }
.meta.accent { background: var(--accent-soft); color: var(--accent-ink); }
table { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
thead th { text-align: left; font-family: var(--mono); font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); padding: 12px 14px; border-bottom: 2px solid var(--border); font-weight: 600; }
tbody td { padding: 14px; border-bottom: 1px solid var(--border); vertical-align: top; color: var(--text-soft); }
tbody td:first-child { color: var(--text); font-weight: 600; }
.chart-title { font-size: 17px; font-weight: 700; letter-spacing: -.01em; margin-bottom: 16px; }
.hbar { display: grid; gap: 10px; }
.hbar .row { display: grid; grid-template-columns: 140px 1fr 70px; align-items: center; gap: 12px; font-size: 13.5px; }
.hbar .label { color: var(--text); font-weight: 600; text-align: right; }
.hbar .track { background: var(--surface2); border-radius: 6px; height: 22px; overflow: hidden; }
.hbar .bar { height: 100%; width: var(--w); background: var(--border-strong); border-radius: 6px; }
.hbar .row.focal .bar { background: var(--accent); }
.hbar .val { color: var(--muted); font-family: var(--mono); font-variant-numeric: tabular-nums; }
.diagram { width: 100%; height: auto; display: block; }
.closing { text-align: center; padding: 72px 0 24px; border-bottom: none; }
.closing .line { font-size: 28px; font-weight: 700; line-height: 1.45; letter-spacing: -.01em; max-width: 800px; margin: 0 auto 16px; }
.closing .line b { color: var(--accent-ink); }
@media (max-width: 860px) {
  .wrap { padding: 40px 20px 60px; }
  .geo-grid, .dir-grid, .edge-grid { grid-template-columns: 1fr; }
  thead { display: none; } tbody td { display: block; border: none; padding: 4px 14px; } tbody tr { border-bottom: 1px solid var(--border); padding: 10px 0; }
}
`;
}

function sanitizeGeneratedHtml(raw: string): string {
  let html = raw.trim()
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const styles = html.match(/<style\b[\s\S]*?<\/style>/gi)?.join("\n") ?? "";
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    html = `${styles}\n${bodyMatch[1]}`;
  } else {
    html = html
      .replace(/<!doctype[^>]*>/gi, "")
      .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, styles)
      .replace(/<\/?html\b[^>]*>/gi, "")
      .replace(/<\/?body\b[^>]*>/gi, "");
  }

  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object\b[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/\s(href|src)\s*=\s*"javascript:[^"]*"/gi, ' $1="#"')
    .replace(/\s(href|src)\s*=\s*'javascript:[^']*'/gi, " $1='#'")
    .trim();
}

async function prepareCodexAuthEnv(workDir: string): Promise<Record<string, string>> {
  const accessToken = optionalEnv("CODEX_ACCESS_TOKEN");
  if (accessToken) {
    return { CODEX_ACCESS_TOKEN: accessToken };
  }

  const authJson = getCodexAuthJson();
  if (!authJson) {
    return {};
  }

  const codexHome = join(workDir, "codex-home");
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await writeFile(join(codexHome, "auth.json"), authJson, { encoding: "utf8", mode: 0o600 });

  return { CODEX_HOME: codexHome };
}

export function getCodexAuthJson(): string | null {
  const base64 = optionalEnv("CODEX_AUTH_JSON_BASE64");
  const raw = base64
    ? Buffer.from(base64, "base64").toString("utf8")
    : optionalEnv("CODEX_AUTH_JSON");

  if (!raw) {
    return null;
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("CODEX_AUTH_JSON does not contain a JSON object.");
  }

  const json = raw.slice(start, end + 1);
  const parsed = JSON.parse(json) as {
    auth_mode?: string;
    tokens?: unknown;
  };

  if (parsed.auth_mode !== "chatgpt" || typeof parsed.tokens !== "object" || !parsed.tokens) {
    throw new Error("CODEX_AUTH_JSON is not a valid ChatGPT Codex auth file.");
  }

  return `${JSON.stringify(parsed)}\n`;
}
