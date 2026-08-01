import { createHash } from "node:crypto";
import { execFile, type ExecFileOptions } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sanitizeHtml from "sanitize-html";
import { putBinaryObject } from "@/lib/bucket";
import { documentFromMarkdown, parseDocumentJson, type DocumentHtmlJson } from "@/lib/document";
import type { PageLanguage } from "@/lib/db";
import { optionalEnv } from "@/lib/env";
import { preserveGeneratedConnections } from "@/lib/generated-connections";
import { renderHtmlBody } from "@/lib/render-html";

const aiGatewayBaseUrl = "https://aigateway.inevitable.tech/v1";

function codexGenerationArgs(reasoningEffort: "low" | "medium" = "medium"): readonly string[] {
  if (!optionalEnv("AI_GATEWAY_API_KEY")) {
    return [
      "--model",
      "gpt-5.6-terra",
      "-c",
      `model_reasoning_effort="${reasoningEffort}"`,
    ];
  }

  return [
    "--model",
    `cx/gpt-5.6-terra-${reasoningEffort}`,
    "-c",
    'model_provider="inevitable_gateway"',
    "-c",
    'model_providers.inevitable_gateway.name="Inevitable AI Gateway"',
    "-c",
    `model_providers.inevitable_gateway.base_url="${aiGatewayBaseUrl}"`,
    "-c",
    'model_providers.inevitable_gateway.env_key="AI_GATEWAY_API_KEY"',
    "-c",
    'model_providers.inevitable_gateway.wire_api="responses"',
  ];
}

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
  targetLanguage?: PageLanguage;
  pageId?: string;
}): Promise<string> {
  if (optionalEnv("CODEX_GENERATION_ENABLED") !== "false" && hasCodexCredentials()) {
    return removeIosgLogoImages(await generateHtmlWithCodex(input));
  }

  return removeIosgLogoImages(renderHtmlBody(documentFromMarkdown(input)));
}

export async function describeImageAsset(input: {
  imagePath: string;
  altText: string;
  sourceUrl: string;
}): Promise<string> {
  if (optionalEnv("CODEX_GENERATION_ENABLED") === "false" || !hasCodexCredentials()) {
    return fallbackImageDescription(input.altText);
  }

  return describeImageWithCodex(input);
}

function isMissingCodexBinaryError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function shouldUseCodex(): boolean {
  if (optionalEnv("CODEX_GENERATION_ENABLED") === "false") return false;
  return hasCodexCredentials();
}

function hasCodexCredentials(): boolean {
  return Boolean(
    optionalEnv("AI_GATEWAY_API_KEY") ||
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
  const codexBin = codexBinaryPath();
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

    await execFileNoStdin(
      codexBin,
      [
        "exec",
        ...codexGenerationArgs("medium"),
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
        env: codexProcessEnv(authEnv),
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
  targetLanguage?: PageLanguage;
  pageId?: string;
}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "notion-to-html-codex-"));
  const markdownPath = join(dir, "notion.md");
  const artifactPath = join(dir, "artifact.html");
  const outputPath = join(dir, "last-message.html");
  const generatedAssetsPath = join(dir, "generated-assets");
  const codexBin = codexBinaryPath();
  const authEnv = await prepareCodexAuthEnv(dir);

  try {
    await mkdir(generatedAssetsPath, { recursive: true });
    await writeFile(markdownPath, input.markdown, "utf8");

    const result = await execFileNoStdin(
      codexBin,
      [
        "exec",
        ...codexGenerationArgs("medium"),
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "--cd",
        dir,
        "-o",
        outputPath,
        documentToHtmlPrompt(
          input.notionUrl,
          "artifact.html",
          input.markdown,
          input.targetLanguage ?? "auto",
          Boolean(input.pageId),
        ),
      ],
      {
        cwd: dir,
        timeout: 12 * 60_000,
        maxBuffer: 20 * 1024 * 1024,
        env: codexProcessEnv(authEnv),
      },
    );

    const { stdout, stderr } = normalizeExecResult(result);
    const raw = await readCodexHtmlArtifact([artifactPath, outputPath], stdout, stderr);
    const withGeneratedAssets = input.pageId
      ? await persistGeneratedDiagramAssets({
          html: raw,
          generatedAssetsPath,
          pageId: input.pageId,
          requiredMermaidCount: countMermaidBlocks(input.markdown),
        })
      : raw;
    const html = preserveGeneratedConnections(sanitizeGeneratedHtml(withGeneratedAssets), input.markdown, input.notionUrl);

    if (!hasSourceCoverage(html, input.markdown)) {
      return renderHtmlBody(documentFromMarkdown(input));
    }

    return html;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function describeImageWithCodex(input: {
  imagePath: string;
  altText: string;
  sourceUrl: string;
}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "notion-to-html-image-codex-"));
  const outputPath = join(dir, "description.txt");
  const codexBin = codexBinaryPath();
  const authEnv = await prepareCodexAuthEnv(dir);

  try {
    const result = await execFileNoStdin(
      codexBin,
      [
        "exec",
        ...codexGenerationArgs("low"),
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "--cd",
        dir,
        "-i",
        input.imagePath,
        "-o",
        outputPath,
        [
          "Describe this Notion page image for a generated HTML document.",
          `Alt text: ${input.altText || "Image"}`,
          `Source URL: ${input.sourceUrl}`,
          "Return one concise factual sentence. Mention whether it appears to be a product demo, UI screenshot, chart, graph, diagram, photo, or other visual when clear. Do not invent values that are not visible.",
        ].join("\n"),
      ],
      {
        cwd: dir,
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
        env: codexProcessEnv(authEnv),
      },
    );

    const raw = await readCodexTextArtifact(outputPath, result.stdout);
    return normalizeImageDescription(raw, input.altText);
  } catch (error) {
    if (isMissingCodexBinaryError(error)) {
      return fallbackImageDescription(input.altText);
    }
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function documentToHtmlPrompt(
  notionUrl: string,
  artifactFile: string,
  markdown: string,
  targetLanguage: PageLanguage,
  generatedAssetOutputEnabled: boolean,
): string {
  return [
    "Use the document-to-html skill to convert notion.md into a polished HTML page.",
    "Source URL:",
    notionUrl,
    "",
    "Output contract:",
    `- Write the exact HTML artifact to ${artifactFile} in the current working directory.`,
    "- The final answer must be only the HTML artifact. No markdown fences, explanation, JSON, or comments.",
    "- Return a body artifact for an existing app shell: include one <style data-document-to-html> tag and one <main class=\"document-html-page wrap\"> root.",
    "- Do not include <!doctype>, <html>, <head>, <body>, <script>, iframe, object, embed, external CSS, external JS, or CDN fonts.",
    "- Do not include the IOSG name, IOSG logo, IOSG wordmark, or any publisher branding that is not present as source content. Never invent a logo.",
    "- Preserve public image URLs as <img> when useful. Preserve source links with normal <a href> links.",
    "- Preserve /assets/... local image URLs exactly when including source images.",
    "- Use Codex image descriptions from notion.md as factual visual context. Include product demos, UI screenshots, photos, and mechanism visuals directly when they help readers inspect the source. For charts and graphs, either re-render the message as a clean chart/table or summarize the text if the image is too noisy.",
    ...generatedDiagramPromptLines(markdown, generatedAssetOutputEnabled),
    "- Preserve all linked Notion subpages from notion.md. Include them as source links, related pages, appendix links, or detail rows, but do not drop the connection.",
    "- In references, source links, related pages, and appendix sections, omit emoji from visible labels. Preserve the linked text and URL.",
    "- Use native <details class=\"x\"> rows for depth. The page should be skimmable first and expandable second.",
    "",
    ...notionDatabasePromptLines(notionUrl, markdown),
    "",
    ...sourceCoveragePromptLines(markdown),
    "",
    ...documentToHtmlLanguageGuidance(markdown, targetLanguage),
    "",
    "Document-to-html design language:",
    "- Follow Kami's restrained editorial language: parchment #f5f4ed, ivory #faf9f5, warm near-black #141413, warm gray text, and ink blue #1B365D as the only chromatic accent.",
    "- Use a Charter, Iowan Old Style, Palatino, Georgia serif stack for English prose and headings. Use appropriate CJK serif fallbacks for Chinese or Japanese. Use a JetBrains Mono-style stack only for labels, tags, KPI values, and table heads.",
    "- Section labels use numeric prefixes. For English pages, examples include 01 · THESIS, 02 · PRODUCT, 03 · TRACTION, 04 · RISKS. For Chinese pages, use Chinese labels such as 01 · 论点, 02 · 市场, 03 · 机会, 04 · 风险.",
    "- Use 3 to 5 sections. Put surface claims in hero, KPI rows, cards, charts, or visible summaries. Put reasoning in <details class=\"x\"> bodies.",
    "- Prefer assertion headings over labels, written in the output language.",
    "- Use one or two ink blue focal elements per section or diagram. Keep ink blue below about five percent of the page surface.",
    "- Prefer flat editorial sections, thin warm borders, four to eight pixel radii, and quiet ring shadows. Avoid glossy cards, gradients, pill-heavy layouts, and hard drop shadows.",
    "- Cut internal notes, self-coaching, QA prompts, and sensitive deal terms unless the source clearly frames them as public-facing.",
    "",
    "Contrast checklist (blocking before writing the artifact):",
    "- Verify every computed foreground and effective background pair in the served app shell, including nested p, blockquote, strong, b, a, labels, pills, captions, table cells, and SVG text.",
    "- Normal text must reach at least 4.5:1 contrast. Large text must reach at least 3:1. Do not round a failing ratio up.",
    "- Light text is allowed only on a reliably dark surface. On inverse cards, explicitly keep nested semantic elements transparent with color: inherit so host styles cannot turn them into light-on-light text.",
    "- Check default, hover, focus, open details, and disabled states at desktop and about 380px width. Do not ship any invisible or barely readable text.",
    "",
    "Required CSS base and components to include inside <style data-document-to-html>:",
    documentToHtmlCss(),
    "",
    "Build a complete page from notion.md. If the document has quantitative content, use KPI cards, a small chart, or a table. Render mechanisms as diagram images through the generated-assets contract. Every major claim should have an expandable detail row.",
  ].join("\n");
}

function generatedDiagramPromptLines(markdown: string, enabled: boolean): string[] {
  if (!enabled) {
    return ["- Do not output inline SVG or generated asset references because this caller has no generated-asset storage."];
  }

  const mermaidCount = countMermaidBlocks(markdown);
  return [
    `- Source Mermaid blocks: ${mermaidCount}. Render every block to a separate PNG image; omission is a generation failure.`,
    "- Treat Mermaid and every concept diagram as images. Write PNG files under generated-assets/ and reference each one as <img src=\"generated-assets/descriptive-name.png\" alt=\"...\">.",
    "- Use the document-to-html skill renderer when available. Do not put Mermaid syntax, inline SVG, data URLs, canvas, or chart runtime JavaScript in artifact.html.",
    "- Keep generated image filenames flat and limited to ASCII letters, digits, dots, underscores, and hyphens.",
    "- A diagram must teach hierarchy, direction, or magnitude better than a paragraph. Use a table for simple comparison and prose for a single labeled box.",
    "- Keep editorial diagram density near 4/10 with at most 9 nodes. Split larger ideas. Highlight only 1 or 2 focal nodes.",
    "- Render diagrams on #f5f4ed with #faf9f5 nodes, #504e49 connectors, #141413 text, #e8e6dc borders, and #1B365D only for focal paths. Use orthogonal connectors and short text labels.",
  ];
}

function notionDatabasePromptLines(notionUrl: string, markdown: string): string[] {
  if (!looksLikeNotionDatabase(notionUrl, markdown)) return [];

  return [
    "Notion database/table generation requirements:",
    "- Keep the landing hero. A database page still needs a readable front door with title, source URL, row counts, and section navigation.",
    "- Render every available database row. A curated subset is only acceptable when the user explicitly asks for a digest.",
    "- Use the database shape: hero with row stats -> 01 overview/thesis -> 02 latest/featured rows -> 03 all entries table with search/filter -> optional category summary.",
    "- Row title links should point to generated HTML subpage routes, using /api/pages?notionUrl=<encoded Notion row URL> when row URLs are available.",
    "- Add a small \"Notion row\" link for the original source row when a row URL is available.",
    "- Keep product or external URLs in their own column instead of replacing the row title link.",
    "- Convert markdown links, bold text, lists, headings, and fenced code before writing table cells. Visible raw markdown is a bug.",
    "- Use .md containers and overflow-wrap:anywhere for long descriptions, URLs, package names, and identifiers.",
    "- Do not classify Notion icons, emoji assets, /icons/, /images/, or same-page anchors as linked subpages.",
    "- Keep plain tables when columns carry meaning. Do not try to make <tr> expandable; put native <details> inside a description cell or below the table if needed.",
  ];
}

function looksLikeNotionDatabase(notionUrl: string, markdown: string): boolean {
  const normalized = markdown.toLowerCase();
  const hasNotionViewUrl = /[?&]v=[0-9a-f-]{8,}/i.test(notionUrl);
  const hasDatabaseWord = /\bdatabase\b|\btable\b|collection view/i.test(markdown);
  const hasCoreColumns = [
    /^name$/im,
    /^description$/im,
    /^url$/im,
    /^category$/im,
    /^created time$/im,
  ].filter((pattern) => pattern.test(markdown)).length >= 3;

  return hasNotionViewUrl || (hasDatabaseWord && hasCoreColumns) || normalized.includes("notion database");
}

function sourceCoveragePromptLines(markdown: string): string[] {
  const anchors = sourceCoverageAnchors(markdown).slice(0, 12);
  if (anchors.length === 0) return [];

  return [
    "Source coverage requirements:",
    "- Read notion.md directly before writing the artifact.",
    "- Preserve concrete source entities, row names, URLs, and source facts. Do not write a generic page about the conversion task.",
    "- The generated HTML must include several of these source anchors:",
    ...anchors.map((anchor) => `  - ${anchor}`),
  ];
}

function hasSourceCoverage(html: string, markdown: string): boolean {
  const anchors = sourceCoverageAnchors(markdown).slice(0, 8);
  if (anchors.length < 3) return true;

  const haystack = normalizeCoverageText(
    html
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
  const matches = anchors.filter((anchor) => haystack.includes(normalizeCoverageText(anchor)));

  return matches.length >= 2;
}

function sourceCoverageAnchors(markdown: string): string[] {
  const anchors: string[] = [];
  const seen = new Set<string>();
  let insideMermaidBlock = false;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!insideMermaidBlock && /^```mermaid\s*$/i.test(line)) {
      insideMermaidBlock = true;
      continue;
    }
    if (insideMermaidBlock) {
      if (/^```\s*$/.test(line)) insideMermaidBlock = false;
      continue;
    }
    if (!line || /^#{1,6}\s+/.test(line) || isLowSignalSourceLine(line)) continue;

    const anchor = cleanCoverageAnchor(line);
    const normalized = normalizeCoverageText(anchor);
    if (!anchor || normalized.length < 3 || seen.has(normalized)) continue;
    if (isLowSignalSourceLine(anchor)) continue;

    anchors.push(anchor);
    seen.add(normalized);
    if (anchors.length >= 20) break;
  }

  return anchors;
}

function cleanCoverageAnchor(line: string): string {
  return line
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/<Base64-Image-Removed>/gi, " ")
    .replace(/[`*_>]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function isLowSignalSourceLine(line: string): boolean {
  const normalized = normalizeCoverageText(line);
  if (!normalized) return true;
  if (/^https?:\/\//i.test(line)) return true;
  if (/^!\[/.test(line)) return true;
  if (/^[a-z]+:\/\/\S+$/i.test(line)) return true;
  if (/^[A-Za-z]+\s+\d{1,2},\s+\d{4}/.test(line)) return true;
  if (!/[\p{Script=Han}A-Za-z0-9]/u.test(line)) return true;

  return new Set([
    "table",
    "group",
    "name",
    "description",
    "url",
    "category",
    "created time",
    "mentioned notion pages",
    "images",
    "page icon",
    "skip to content",
  ]).has(normalized);
}

function normalizeCoverageText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function documentToHtmlLanguageGuidance(markdown: string, targetLanguage: PageLanguage): string[] {
  if (targetLanguage !== "auto") {
    return selectedLanguageGuidance(targetLanguage);
  }

  if (detectChineseSource(markdown)) {
    return [
      "Language contract:",
      "- Detected source language: Simplified Chinese.",
      "- Write the generated page in Simplified Chinese, including prose, headings, summaries, labels, captions, details, chart text, and table framing.",
      "- Do not translate Chinese source passages into English.",
      "- Keep proper nouns, company names, product names, tickers, URLs, and source quotes in their original form.",
      "- Put spaces between Chinese text and embedded English words or names.",
    ];
  }

  return [
    "Language contract:",
    "- Preserve the dominant source language for generated prose, headings, summaries, labels, captions, details, chart text, and table framing.",
    "- Keep proper nouns, company names, product names, tickers, URLs, and source quotes in their original form.",
  ];
}

function selectedLanguageGuidance(targetLanguage: Exclude<PageLanguage, "auto">): string[] {
  if (targetLanguage === "zh-CN") {
    return [
      "Language contract:",
      "- Selected output language: Simplified Chinese.",
      "- Write the generated page in Simplified Chinese, including prose, headings, summaries, labels, captions, details, chart text, and table framing.",
      "- Translate source passages into clear Simplified Chinese when they are written in another language.",
      "- Keep proper nouns, company names, product names, tickers, URLs, and source quotes in their original form.",
      "- Put spaces between Chinese text and embedded English words or names.",
    ];
  }

  if (targetLanguage === "ja") {
    return [
      "Language contract:",
      "- Selected output language: Japanese.",
      "- Write the generated page in Japanese, including prose, headings, summaries, labels, captions, details, chart text, and table framing.",
      "- Translate source passages into clear Japanese when they are written in another language.",
      "- Keep proper nouns, company names, product names, tickers, URLs, and source quotes in their original form.",
    ];
  }

  return [
    "Language contract:",
    "- Selected output language: English.",
    "- Write the generated page in English, including prose, headings, summaries, labels, captions, details, chart text, and table framing.",
    "- Translate source passages into clear English when they are written in another language.",
    "- Keep proper nouns, company names, product names, tickers, URLs, and source quotes in their original form.",
  ];
}

function detectChineseSource(markdown: string): boolean {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
  const hanCount = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const latinCount = text.match(/[A-Za-z]/g)?.length ?? 0;
  const languageCharCount = hanCount + latinCount;

  return hanCount >= 12 && languageCharCount > 0 && hanCount / languageCharCount > 0.2;
}

function execFileNoStdin(
  file: string,
  args: string[],
  options: ExecFileOptions,
): Promise<{ stdout: string | Buffer; stderr: string | Buffer }> {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        Object.assign(error, { stdout, stderr });
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    }) as ReturnType<typeof execFile> | undefined;

    child?.stdin?.end();
  });
}

function normalizeExecResult(result: unknown): {
  stdout: string | Buffer;
  stderr: string | Buffer;
} {
  if (result && typeof result === "object" && "stdout" in result) {
    const execResult = result as { stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      stdout: execResult.stdout ?? "",
      stderr: execResult.stderr ?? "",
    };
  }

  return {
    stdout: typeof result === "string" || Buffer.isBuffer(result) ? result : "",
    stderr: "",
  };
}

async function readCodexHtmlArtifact(
  outputPaths: string[],
  stdout: string | Buffer,
  stderr: string | Buffer,
): Promise<string> {
  for (const outputPath of outputPaths) {
    try {
      const fileOutput = await readFile(outputPath, "utf8");
      if (fileOutput.trim()) return fileOutput;
    } catch (error) {
      if (!isMissingCodexBinaryError(error)) throw error;
    }
  }

  const stdoutText = outputToText(stdout);
  const stdoutCandidate = extractHtmlCandidate(stdoutText);
  if (stdoutCandidate) return stdoutCandidate;

  const stderrText = outputToText(stderr).trim();
  const suffix = stderrText ? ` Stderr: ${truncateForError(stderrText)}` : "";
  const stdoutSuffix = stdoutText.trim() ? ` Stdout: ${truncateForError(stdoutText.trim())}` : "";
  throw new Error(`Codex did not produce an HTML artifact.${suffix}${stdoutSuffix}`);
}

async function readCodexTextArtifact(
  outputPath: string,
  stdout: string | Buffer,
): Promise<string> {
  try {
    const fileOutput = await readFile(outputPath, "utf8");
    if (fileOutput.trim()) return fileOutput;
  } catch (error) {
    if (!isMissingCodexBinaryError(error)) throw error;
  }

  return outputToText(stdout);
}

function normalizeImageDescription(raw: string, altText: string): string {
  const text = raw
    .trim()
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return fallbackImageDescription(altText);
  return text.length > 280 ? `${text.slice(0, 277).trim()}...` : text;
}

function fallbackImageDescription(altText: string): string {
  return altText.trim()
    ? `Image from the Notion page labeled "${altText.trim()}".`
    : "Image from the Notion page.";
}

function outputToText(output: string | Buffer): string {
  return Buffer.isBuffer(output) ? output.toString("utf8") : output;
}

function extractHtmlCandidate(output: string): string | null {
  const fenced = [...output.matchAll(/```html\s*([\s\S]*?)```/gi)]
    .map((match) => match[1]?.trim() ?? "")
    .find(hasDocumentHtmlMarkers);
  if (fenced) return fenced;

  const styleIndex = output.search(/<style\b[^>]*data-document-to-html/i);
  const mainIndex = output.search(/<main\b[^>]*class=["'][^"']*document-html-page/i);
  const starts = [styleIndex, mainIndex].filter((index) => index >= 0);
  if (starts.length === 0) return null;

  return output.slice(Math.min(...starts)).trim();
}

function truncateForError(text: string): string {
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function documentToHtmlCss(): string {
  return `
:root {
  --bg: #f5f4ed; --surface: #faf9f5; --surface2: #e8e6dc;
  --border: #e8e6dc; --border-strong: #b2b1ac;
  --text: #141413; --text-soft: #3d3d3a; --muted: #6b6a64;
  --accent: #1B365D; --accent-ink: #1B365D; --accent-soft: #EEF2F7;
  --good: #3f5a45; --good-soft: #edf1eb;
  --warn: #8b5f2b; --warn-soft: #f1e9dd;
  --mono: "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace;
  --sans: Charter, "Iowan Old Style", Palatino, "Palatino Linotype", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", Georgia, serif;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { background: var(--bg); color: var(--text); font-family: var(--sans); line-height: 1.7; -webkit-font-smoothing: antialiased; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 64px 40px 80px; }
.hero { padding: 48px 0 56px; border-bottom: 1px solid var(--text); }
.brand { font-family: var(--mono); font-size: 12px; letter-spacing: .08em; color: var(--accent-ink); font-weight: 600; text-transform: uppercase; margin-bottom: 24px; }
h1 { font-size: 48px; line-height: 1.08; font-weight: 500; letter-spacing: 0; margin-bottom: 20px; }
h1 .hl { color: var(--accent); }
.hero-tagline { font-size: 20px; color: var(--text-soft); max-width: 760px; line-height: 1.5; }
.hero-tagline b { color: var(--accent-ink); font-weight: 600; }
section { padding: 56px 0; border-bottom: 1px solid var(--border); }
.shead { display: flex; align-items: baseline; gap: 14px; margin-bottom: 14px; }
.sec-label { font-family: var(--mono); font-size: 12.5px; letter-spacing: .06em; color: var(--accent-ink); font-weight: 700; text-transform: uppercase; }
h2 { font-size: 30px; font-weight: 500; letter-spacing: 0; }
.lede { font-size: 17px; color: var(--text-soft); max-width: 820px; margin-bottom: 36px; }
.lede b { color: var(--text); font-weight: 600; }
a { color: var(--accent-ink); text-decoration: none; }
pre { background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 14px; overflow-x: auto; font-family: var(--mono); font-size: 13px; line-height: 1.55; color: var(--text); }
code { font-family: var(--mono); font-size: .9em; background: var(--surface); border: 1px solid var(--border); padding: 1px 5px; border-radius: 4px; }
pre code { background: transparent; border: 0; padding: 0; font-size: inherit; }
.story { background: var(--surface); border-left: 2px solid var(--accent); padding: 28px 32px; border-radius: 0 4px 4px 0; margin-bottom: 36px; font-size: 16.5px; color: var(--text-soft); line-height: 1.55; }
.story b { color: var(--accent-ink); font-weight: 600; }
.kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 18px; margin-bottom: 24px; }
.kpi { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 22px; text-align: center; }
.kpi.focal { border-color: var(--accent); }
.kpi .n { font-family: var(--mono); font-size: 34px; font-weight: 700; letter-spacing: 0; color: var(--text); line-height: 1.1; font-variant-numeric: tabular-nums; }
.kpi.focal .n { color: var(--accent-ink); }
.kpi .l { font-size: 12.5px; color: var(--muted); margin-top: 6px; }
.geo-grid, .dir-grid, .edge-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-bottom: 28px; }
.dir-grid { grid-template-columns: 1fr 1fr; }
.geo, .dir, .edge, .chart-box, .diagram-box { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 26px 24px; }
.geo.hot, .kpi.focal { border-color: var(--accent); background: var(--accent-soft); }
.tag, .pill { display: inline-block; font-family: var(--mono); font-size: 11px; letter-spacing: .06em; padding: 4px 10px; border-radius: 99px; margin: 2px 4px 14px 0; font-weight: 600; text-transform: uppercase; background: var(--surface2); color: var(--muted); }
.tag.open, .pill.f { background: var(--accent); border-color: var(--accent); color: #fff; }
.geo h3, .dir h3, .edge h3 { font-size: 20px; font-weight: 700; letter-spacing: 0; margin-bottom: 8px; }
.geo p, .dir p, .edge p { font-size: 14.5px; color: var(--text-soft); }
.geo p b, .dir p b, .edge p b { color: var(--text); font-weight: 600; }
.punch { font-size: 22px; font-weight: 700; letter-spacing: 0; text-align: center; padding: 28px; background: var(--surface2); border-radius: 12px; line-height: 1.4; }
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
.chart-title { font-size: 17px; font-weight: 700; letter-spacing: 0; margin-bottom: 16px; }
.hbar { display: grid; gap: 10px; }
.hbar .row { display: grid; grid-template-columns: 140px 1fr 70px; align-items: center; gap: 12px; font-size: 13.5px; }
.hbar .label { color: var(--text); font-weight: 600; text-align: right; }
.hbar .track { background: var(--surface2); border-radius: 6px; height: 22px; overflow: hidden; }
.hbar .bar { height: 100%; width: var(--w); background: var(--border-strong); border-radius: 6px; }
.hbar .row.focal .bar { background: var(--accent); }
.hbar .val { color: var(--muted); font-family: var(--mono); font-variant-numeric: tabular-nums; }
.diagram { width: 100%; height: auto; display: block; }
.closing { text-align: center; padding: 72px 0 24px; border-bottom: none; }
.closing .line { font-size: 28px; font-weight: 700; line-height: 1.45; letter-spacing: 0; max-width: 800px; margin: 0 auto 16px; }
.closing .line b { color: var(--accent-ink); }
@media (max-width: 860px) {
  .wrap { padding: 40px 20px 60px; }
  h1 { font-size: 34px; }
  h2 { font-size: 24px; }
  .hero-tagline { font-size: 17px; }
  .geo-grid, .dir-grid, .edge-grid { grid-template-columns: 1fr; }
  thead { display: none; } tbody td { display: block; border: none; padding: 4px 14px; } tbody tr { border-bottom: 1px solid var(--border); padding: 10px 0; }
}
`;
}

const generatedDiagramReferencePattern = /(?:\.?\/)?generated-assets\/([a-z0-9][a-z0-9._-]{0,120}\.png)/gi;
const maxGeneratedDiagramCount = 12;
const maxGeneratedDiagramBytes = 8 * 1024 * 1024;
const maxGeneratedDiagramTotalBytes = 32 * 1024 * 1024;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function persistGeneratedDiagramAssets(input: {
  html: string;
  generatedAssetsPath: string;
  pageId: string;
  requiredMermaidCount: number;
}): Promise<string> {
  if (/<svg\b/i.test(input.html)) {
    throw new Error("Codex returned inline SVG; Mermaid and concept diagrams must be rendered as PNG images.");
  }

  const references = [...input.html.matchAll(generatedDiagramReferencePattern)];
  const filenames = [...new Set(references.map((match) => match[1]))];
  if (filenames.length < input.requiredMermaidCount) {
    throw new Error(
      `Codex rendered ${filenames.length} diagram images for ${input.requiredMermaidCount} Mermaid blocks.`,
    );
  }
  if (filenames.length > maxGeneratedDiagramCount) {
    throw new Error(`Codex generated too many diagram images: ${filenames.length}.`);
  }

  let totalBytes = 0;
  let rewritten = input.html;
  for (const filename of filenames) {
    const path = join(input.generatedAssetsPath, filename);
    const stats = await lstat(path).catch(() => null);
    if (!stats?.isFile() || stats.isSymbolicLink()) {
      throw new Error(`Generated diagram image is missing or unsafe: ${filename}.`);
    }

    const bytes = await readFile(path);
    totalBytes += bytes.byteLength;
    if (bytes.byteLength === 0 || bytes.byteLength > maxGeneratedDiagramBytes) {
      throw new Error(`Generated diagram image has an invalid size: ${filename}.`);
    }
    if (totalBytes > maxGeneratedDiagramTotalBytes) {
      throw new Error("Generated diagram images exceed the total size limit.");
    }
    if (!bytes.subarray(0, pngSignature.byteLength).equals(pngSignature)) {
      throw new Error(`Generated diagram image is not a PNG: ${filename}.`);
    }

    const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
    const objectKey = `assets/pages/${input.pageId}/generated/${digest}.png`;
    const localUrl = `/${objectKey}`;
    await putBinaryObject(objectKey, bytes, "image/png");
    rewritten = rewritten.replace(
      new RegExp(`(?:\\.?\\/)?generated-assets\\/${escapeRegExp(filename)}`, "g"),
      localUrl,
    );
  }

  if (/generated-assets\//i.test(rewritten)) {
    throw new Error("Generated HTML contains an invalid diagram asset reference.");
  }

  return rewritten;
}

function countMermaidBlocks(markdown: string): number {
  return [...markdown.matchAll(/^```mermaid\s*$[\s\S]*?^```\s*$/gim)].length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

  const mainEnd = html.lastIndexOf("</main>");
  if (mainEnd >= 0) {
    html = html.slice(0, mainEnd + "</main>".length);
  }

  const sanitized = sanitizeHtml(sanitizeStyleBlocks(html), {
    allowedTags: [
      "style",
      "main",
      "section",
      "article",
      "header",
      "footer",
      "div",
      "span",
      "p",
      "br",
      "hr",
      "h1",
      "h2",
      "h3",
      "h4",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "strong",
      "b",
      "em",
      "i",
      "small",
      "mark",
      "a",
      "img",
      "details",
      "summary",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ],
    allowedAttributes: {
      "*": ["class", "id", "role", "aria-*", "data-*"],
      a: ["href", "target", "rel", "title"],
      img: ["src", "alt", "loading", "width", "height"],
      details: ["open"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    nonTextTags: ["script", "textarea", "option", "noscript"],
  }).trim();

  if (!hasDocumentHtmlMarkers(sanitized)) {
    throw new Error("Codex HTML is missing document-to-html markers.");
  }

  return sanitized;
}

function removeIosgLogoImages(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const normalized = tag.toLowerCase();
    const namesIosgBrand = /(?:alt|title)=(?:"[^"]*(?:iosg[^"<>]*(?:logo|wordmark)|(?:logo|wordmark)[^"<>]*iosg)[^"]*"|'[^']*(?:iosg[^'<>]*(?:logo|wordmark)|(?:logo|wordmark)[^'<>]*iosg)[^']*')/i.test(tag);
    const sourceNamesIosgBrand = /src=(?:"[^"]*(?:iosg[-_. ]*(?:logo|wordmark)|(?:logo|wordmark)[-_. ]*iosg)[^"]*"|'[^']*(?:iosg[-_. ]*(?:logo|wordmark)|(?:logo|wordmark)[-_. ]*iosg)[^']*')/i.test(tag);
    return namesIosgBrand || sourceNamesIosgBrand || normalized.includes("data-iosg-logo") ? "" : tag;
  });
}

function sanitizeStyleBlocks(html: string): string {
  return html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_match, attrs: string, css: string) => {
    const safeCss = css
      .split(/(?<=;|})/)
      .filter((chunk: string) => !isUnsafeCssChunk(chunk))
      .join("");

    return `<style${attrs}>${safeCss}</style>`;
  });
}

function isUnsafeCssChunk(css: string): boolean {
  return /url\s*\(|@import|expression\s*\(|javascript\s*:|behavior\s*:|-moz-binding/i.test(css);
}

function hasDocumentHtmlMarkers(html: string): boolean {
  return /<style\b[^>]*data-document-to-html/i.test(html) &&
    /<main\b[^>]*class=["'][^"']*document-html-page/i.test(html);
}

function codexBinaryPath(): string {
  return optionalEnv("CODEX_BIN") ?? join(process.cwd(), "node_modules", ".bin", "codex");
}

function codexProcessEnv(authEnv: Record<string, string>): NodeJS.ProcessEnv {
  const allowedNames = [
    "PATH",
    "TMPDIR",
    "TEMP",
    "TMP",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "SHELL",
    "SYSTEMROOT",
    "WINDIR",
  ];
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV ?? "production",
  };

  for (const name of allowedNames) {
    const value = process.env[name];
    if (value) env[name] = value;
  }

  return {
    ...env,
    ...authEnv,
  };
}

async function prepareCodexAuthEnv(workDir: string): Promise<Record<string, string>> {
  const codexHome = join(workDir, "codex-home");
  await mkdir(codexHome, { recursive: true, mode: 0o700 });

  const gatewayApiKey = optionalEnv("AI_GATEWAY_API_KEY");
  if (gatewayApiKey) {
    return { AI_GATEWAY_API_KEY: gatewayApiKey, CODEX_HOME: codexHome, HOME: codexHome };
  }

  const accessToken = optionalEnv("CODEX_ACCESS_TOKEN");
  if (accessToken) {
    return { CODEX_ACCESS_TOKEN: accessToken, CODEX_HOME: codexHome, HOME: codexHome };
  }

  const authJson = getCodexAuthJson();
  if (!authJson) {
    return { CODEX_HOME: codexHome, HOME: codexHome };
  }

  await writeFile(join(codexHome, "auth.json"), authJson, { encoding: "utf8", mode: 0o600 });

  return { CODEX_HOME: codexHome, HOME: codexHome };
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
