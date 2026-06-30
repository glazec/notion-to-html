import type { DocumentBlock, DocumentHtmlJson } from "@/lib/document";
import type { PageStatus } from "@/lib/db";

export type ServedPageState = {
  status?: PageStatus;
  generationStep?: string | null;
  generationProgress?: number | null;
  generatedAt?: Date | null;
};

export function renderHtmlBody(document: DocumentHtmlJson): string {
  const contentSections = document.sections
    .map((section) => {
      if (section.type === "hero") {
        return `<section class="nth-hero"><h1>${escapeHtml(section.heading ?? document.title)}</h1>${section.body ? `<p>${escapeInlineMarkdown(section.body)}</p>` : ""}</section>`;
      }

      const blocks = section.blocks?.map(renderBlock).join("\n") ?? "";
      return `<section class="nth-content">${section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : ""}${blocks}</section>`;
    })
    .join("\n");

  return `<main class="nth-document" data-schema-version="${document.schema_version}">\n${contentSections}\n</main>`;
}

export function wrapServedHtml(input: {
  title: string;
  body: string;
  notionUrl: string;
  regeneratePath: string;
  pageState?: ServedPageState;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.title)}</title>
  <link rel="icon" href="/favicon.svg" />
  ${shouldAutoRefresh(input.pageState) ? '<meta http-equiv="refresh" content="5" />' : ""}
  <style>${servedCss()}</style>
</head>
<body>
${input.body}
${toolbarHtml(input.notionUrl, input.regeneratePath, input.pageState)}
</body>
</html>`;
}

function renderBlock(block: DocumentBlock): string {
  switch (block.type) {
    case "heading": {
      const level = Math.min(Math.max(block.level ?? 2, 2), 3);
      return `<h${level}>${escapeHtml(block.text ?? "")}</h${level}>`;
    }
    case "list_item":
      return `<p class="nth-list-item">${escapeInlineMarkdown(block.text ?? "")}</p>`;
    case "quote":
      return `<blockquote>${escapeInlineMarkdown(block.text ?? "")}</blockquote>`;
    case "code":
      return `<pre><code>${escapeHtml(block.text ?? "")}</code></pre>`;
    case "image":
      if (!block.url) return "";
      return `<figure class="nth-image"><img src="${escapeAttribute(block.url)}" alt="${escapeAttribute(block.alt ?? block.text ?? "Image")}" loading="lazy" />${block.text ? `<figcaption>${escapeHtml(block.text)}</figcaption>` : ""}</figure>`;
    case "table":
      return renderTable(block.rows ?? []);
    default:
      return `<p>${escapeInlineMarkdown(block.text ?? "")}</p>`;
  }
}

function renderTable(rows: string[][]): string {
  if (rows.length === 0) return "";

  const header = rows[0]
    .map((cell) => `<th>${escapeInlineMarkdown(cell)}</th>`)
    .join("");
  const bodyRows = rows
    .slice(1)
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeInlineMarkdown(cell)}</td>`).join("")}</tr>`)
    .join("");

  return `<div class="nth-table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${bodyRows}</tbody></table></div>`;
}

function toolbarHtml(
  notionUrl: string,
  regeneratePath: string,
  pageState: ServedPageState | undefined,
): string {
  const freshness = freshnessLabel(pageState?.generatedAt);
  const progress = normalizedProgress(pageState);
  const status = pageState?.status ?? "ready";
  const showToolbarProgress = isGenerationActive(pageState) && Boolean(pageState?.generatedAt);
  const refreshCopy = status === "generating" || status === "queued"
    ? `Current copy is ${freshness.toLowerCase()}. A refresh is already in progress.`
    : `Current copy is ${freshness.toLowerCase()}.`;

  return `<div class="nth-toolbar" aria-label="Page tools">
  ${showToolbarProgress ? toolbarProgressHtml(pageState, freshness) : `<span class="nth-freshness" title="${escapeAttribute(freshness)}">${escapeHtml(toolbarFreshnessLabel(pageState))}</span>`}
  <span class="nth-tool-wrap" data-tooltip="Open source Notion page">
  <a class="nth-tool" href="${escapeAttribute(notionUrl)}" target="_blank" rel="noreferrer" aria-label="Open source Notion page">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>
  </a>
  </span>
  <span class="nth-tool-wrap" data-tooltip="Regenerate page">
    <button class="nth-tool" type="button" aria-label="Regenerate page" data-refresh-open>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12A9 9 0 0 1 18.5 5.8L21 8"/><path d="M21 3v5h-5"/></svg>
    </button>
  </span>
</div>
<dialog class="nth-dialog" id="nth-refresh-dialog">
  <form method="dialog" class="nth-dialog-close-form">
    <button class="nth-dialog-close" type="submit" aria-label="Close">&times;</button>
  </form>
  <h2>Regenerate page?</h2>
  <p>${escapeHtml(refreshCopy)}</p>
  ${progress > 0 && progress < 100 ? `<div class="nth-progress"><span style="width:${progress}%"></span></div>` : ""}
  <div class="nth-dialog-actions">
    <form method="dialog"><button class="nth-dialog-secondary" type="submit">Cancel</button></form>
    <form id="nth-refresh-form" action="${escapeAttribute(regeneratePath)}" method="post">
      <button class="nth-dialog-primary" type="submit">Regenerate</button>
    </form>
  </div>
</dialog>
<script>
(() => {
  const dialog = document.getElementById("nth-refresh-dialog");
  const open = document.querySelector("[data-refresh-open]");
  const form = document.getElementById("nth-refresh-form");
  open?.addEventListener("click", () => {
    if (dialog && typeof dialog.showModal === "function") {
      dialog.showModal();
      return;
    }
    if (window.confirm("Regenerate this page? ${escapeJs(refreshCopy)}")) {
      form?.submit();
    }
  });
})();
</script>`;
}

function toolbarProgressHtml(pageState: ServedPageState | undefined, freshness: string): string {
  const progress = normalizedProgress(pageState);
  const step = pageState?.generationStep || "Refreshing cached HTML";

  return `<details class="nth-progress-details">
    <summary class="nth-freshness nth-progress-summary" title="${escapeAttribute(step)}">
      <span>Refreshing ${progress}%</span>
      <span class="nth-mini-progress" aria-hidden="true"><span style="width:${progress}%"></span></span>
    </summary>
    <div class="nth-progress-panel" role="status">
      <strong>Refreshing cached HTML</strong>
      <p>${escapeHtml(step)}</p>
      <div class="nth-progress"><span style="width:${progress}%"></span></div>
      <small>${escapeHtml(freshness)}</small>
    </div>
  </details>`;
}

export function progressBodyHtml(pageState: ServedPageState): string {
  const progress = normalizedProgress(pageState);
  const step = pageState.generationStep || "Queued";
  const failed = pageState.status === "failed";

  return `<main class="nth-document"><section class="nth-hero nth-progress-page">
    <h1>${failed ? "Generation failed" : "Generating HTML"}</h1>
    <p>${escapeHtml(step)}</p>
    <div class="nth-progress" aria-label="Generation progress"><span style="width:${progress}%"></span></div>
    <p class="nth-progress-copy">${failed ? "Use regenerate to try again." : `${progress}% complete. This page refreshes every few seconds.`}</p>
  </section></main>`;
}

function shouldAutoRefresh(pageState: ServedPageState | undefined): boolean {
  return pageState?.status === "queued" || pageState?.status === "generating";
}

function isGenerationActive(pageState: ServedPageState | undefined): boolean {
  return pageState?.status === "queued" || pageState?.status === "generating";
}

function normalizedProgress(pageState: ServedPageState | undefined): number {
  const value = pageState?.generationProgress ?? 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function toolbarFreshnessLabel(pageState: ServedPageState | undefined): string {
  if (!pageState?.generatedAt) {
    return "Not generated yet";
  }

  if (pageState?.status === "generating" || pageState?.status === "queued") {
    return `Refreshing ${normalizedProgress(pageState)}%`;
  }

  if (pageState?.status === "failed") {
    return "Refresh failed";
  }

  return freshnessLabel(pageState?.generatedAt);
}

function freshnessLabel(generatedAt: Date | null | undefined): string {
  if (!generatedAt) return "Not generated yet";

  const ageMs = Math.max(0, Date.now() - generatedAt.getTime());
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (ageMs < minute) return "Fresh just now";
  if (ageMs < hour) return `Fresh ${Math.floor(ageMs / minute)}m ago`;
  if (ageMs < day) return `Fresh ${Math.floor(ageMs / hour)}h ago`;
  return `Fresh ${Math.floor(ageMs / day)}d ago`;
}

function servedCss(): string {
  return `
:root { color-scheme: light; --fg:#050505; --muted:#666; --line:#e5e5e5; --soft:#fafafa; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: var(--fg); font-family: Arial, Helvetica, sans-serif; }
.nth-document { width: min(860px, calc(100% - 40px)); margin: 0 auto; padding: 72px 0 112px; }
.nth-hero { padding: 60px 0 52px; border-bottom: 1px solid var(--line); }
.nth-hero h1 { margin: 0; font-size: clamp(42px, 8vw, 88px); line-height: .96; letter-spacing: 0; }
.nth-hero p { margin: 24px 0 0; color: var(--muted); font-size: 20px; line-height: 1.6; max-width: 680px; }
.nth-content { padding: 44px 0; }
.nth-content h2 { margin: 40px 0 12px; font-size: 28px; line-height: 1.2; }
.nth-content h3 { margin: 32px 0 10px; font-size: 22px; line-height: 1.25; }
.nth-content p, .nth-content blockquote { font-size: 17px; line-height: 1.7; }
.nth-content p { margin: 14px 0; }
.nth-content a { text-decoration: underline; text-underline-offset: 3px; }
.nth-list-item { padding-left: 18px; position: relative; }
.nth-list-item::before { content: ""; position: absolute; left: 2px; top: .78em; width: 5px; height: 5px; border-radius: 999px; background: var(--fg); }
blockquote { margin: 24px 0; padding: 16px 18px; border-left: 3px solid var(--fg); background: var(--soft); }
pre { overflow: auto; padding: 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--soft); }
.nth-image { margin: 28px 0; }
.nth-image img { display: block; width: 100%; max-height: 720px; object-fit: contain; border-radius: 8px; border: 1px solid var(--line); background: var(--soft); }
.nth-image figcaption { margin-top: 8px; color: var(--muted); font-size: 13px; line-height: 1.45; }
.nth-table-wrap { margin: 24px 0; overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; }
.nth-table-wrap table { width: 100%; border-collapse: collapse; min-width: 560px; }
.nth-table-wrap th, .nth-table-wrap td { padding: 12px 14px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; font-size: 15px; line-height: 1.55; }
.nth-table-wrap th { background: var(--soft); font-weight: 700; }
.nth-table-wrap tr:last-child td { border-bottom: 0; }
.nth-progress { height: 6px; overflow: hidden; border-radius: 999px; background: var(--line); }
.nth-progress span { display: block; height: 100%; width: 0; border-radius: inherit; background: var(--fg); transition: width .25s ease; }
.nth-progress-page .nth-progress { margin-top: 24px; max-width: 520px; }
.nth-progress-copy { font-size: 14px !important; color: var(--muted); }
.nth-toolbar { position: fixed; right: 18px; bottom: 18px; display: flex; align-items: center; gap: 4px; padding: 4px; border: 1px solid #d4d4d4; border-radius: 8px; background: rgba(255,255,255,.96); box-shadow: 0 12px 34px rgba(0,0,0,.14); z-index: 50; }
.nth-freshness { height: 36px; display: inline-flex; align-items: center; padding: 0 10px; color: var(--muted); font-size: 12px; white-space: nowrap; border-right: 1px solid var(--line); }
.nth-progress-details { position: relative; }
.nth-progress-details summary { list-style: none; cursor: pointer; }
.nth-progress-details summary::-webkit-details-marker { display: none; }
.nth-progress-summary { min-width: 118px; display: grid; align-content: center; gap: 4px; }
.nth-mini-progress { display: block; height: 3px; overflow: hidden; border-radius: 999px; background: var(--line); }
.nth-mini-progress span { display: block; height: 100%; border-radius: inherit; background: var(--fg); }
.nth-progress-panel { position: absolute; right: 0; bottom: calc(100% + 10px); width: 280px; padding: 14px; border: 1px solid #d4d4d4; border-radius: 8px; background: #fff; box-shadow: 0 18px 46px rgba(0,0,0,.18); }
.nth-progress-panel strong { display: block; margin-bottom: 6px; font-size: 14px; }
.nth-progress-panel p { margin: 0 0 12px; color: var(--muted); font-size: 13px; line-height: 1.45; }
.nth-progress-panel small { display: block; margin-top: 10px; color: var(--muted); font-size: 12px; }
.nth-tool-wrap { position: relative; display: inline-grid; place-items: center; }
.nth-tool-wrap::after { content: attr(data-tooltip); position: absolute; right: 0; bottom: calc(100% + 8px); pointer-events: none; opacity: 0; transform: translateY(4px); transition: opacity .15s ease, transform .15s ease; white-space: nowrap; border: 1px solid #d4d4d4; border-radius: 6px; background: var(--fg); color: #fff; padding: 6px 8px; font-size: 12px; box-shadow: 0 8px 18px rgba(0,0,0,.14); }
.nth-tool-wrap:hover::after, .nth-tool-wrap:focus-within::after { opacity: 1; transform: translateY(0); }
.nth-tool { width: 36px; height: 36px; border: 0; border-radius: 6px; color: var(--fg); background: transparent; display: grid; place-items: center; cursor: pointer; }
.nth-tool:hover { background: var(--soft); }
.nth-tool svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.nth-dialog { width: min(420px, calc(100% - 32px)); border: 1px solid var(--line); border-radius: 8px; padding: 22px; color: var(--fg); background: #fff; box-shadow: 0 28px 80px rgba(0,0,0,.24); }
.nth-dialog::backdrop { background: rgba(0,0,0,.28); }
.nth-dialog h2 { margin: 0; font-size: 22px; line-height: 1.25; }
.nth-dialog p { margin: 12px 0 0; color: var(--muted); font-size: 15px; line-height: 1.55; }
.nth-dialog-close-form { margin: 0; }
.nth-dialog-close { position: absolute; right: 12px; top: 10px; width: 30px; height: 30px; border: 0; border-radius: 6px; background: transparent; cursor: pointer; font-size: 22px; line-height: 1; }
.nth-dialog-close:hover { background: var(--soft); }
.nth-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.nth-dialog-actions form { margin: 0; }
.nth-dialog-primary, .nth-dialog-secondary { height: 38px; border-radius: 6px; padding: 0 14px; cursor: pointer; }
.nth-dialog-primary { border: 1px solid var(--fg); background: var(--fg); color: #fff; }
.nth-dialog-secondary { border: 1px solid var(--line); background: #fff; color: var(--fg); }
@media (max-width: 640px) { .nth-document { width: min(100% - 28px, 860px); padding-top: 24px; } .nth-freshness { max-width: 116px; overflow: hidden; text-overflow: ellipsis; } .nth-progress-panel { width: min(280px, calc(100vw - 36px)); } }
`;
}

function escapeInlineMarkdown(value: string): string {
  return renderMarkdownLinks(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function renderMarkdownLinks(value: string): string {
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let output = "";
  let lastIndex = 0;

  for (const match of value.matchAll(linkPattern)) {
    const index = match.index ?? 0;
    output += escapeHtml(value.slice(lastIndex, index));
    output += `<a href="${escapeAttribute(servedHref(match[2]))}">${escapeHtml(match[1])}</a>`;
    lastIndex = index + match[0].length;
  }

  output += escapeHtml(value.slice(lastIndex));
  return output;
}

function servedHref(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "notion.so" || host.endsWith(".notion.so") || host === "notion.com" || host.endsWith(".notion.com") || host === "notion.site" || host.endsWith(".notion.site")) {
      return `/api/pages?notionUrl=${encodeURIComponent(url)}`;
    }
  } catch {
    return url;
  }

  return url;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("\n", "");
}

function escapeJs(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", " ");
}
