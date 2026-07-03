import type { DocumentBlock, DocumentHtmlJson } from "@/lib/document";
import type { GenerationLogEntry, PageLanguage, PageStatus } from "@/lib/db";

export type ServedPageState = {
  status?: PageStatus;
  generationStep?: string | null;
  generationProgress?: number | null;
  generationLog?: GenerationLogEntry[] | null;
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
  languagePath?: string;
  preferredLanguage?: PageLanguage;
  pageState?: ServedPageState;
}): string {
  const htmlLang = detectServedHtmlLang(input.title, input.body);
  const languagePath = input.languagePath ?? input.regeneratePath.replace(/\/regenerate$/, "/language");

  return `<!doctype html>
<html lang="${htmlLang}">
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
${toolbarHtml(input.notionUrl, input.regeneratePath, languagePath, input.pageState, htmlLang, input.preferredLanguage ?? "auto")}
</body>
</html>`;
}

function detectServedHtmlLang(title: string, body: string): "en" | "zh-CN" {
  const text = `${title}\n${stripHtmlForLanguageDetection(body)}`;
  const hanCount = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const latinCount = text.match(/[A-Za-z]/g)?.length ?? 0;

  return hanCount >= 8 && hanCount >= latinCount * 0.08 ? "zh-CN" : "en";
}

function stripHtmlForLanguageDetection(value: string): string {
  return value
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ");
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
  languagePath: string,
  pageState: ServedPageState | undefined,
  htmlLang: "en" | "zh-CN",
  preferredLanguage: PageLanguage,
): string {
  const freshness = freshnessLabel(pageState?.generatedAt);
  const progress = normalizedProgress(pageState);
  const status = pageState?.status ?? "ready";
  const showToolbarProgress = (isGenerationActive(pageState) || hasGenerationLog(pageState)) && Boolean(pageState?.generatedAt);
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
  <div class="nth-toolbar-menu" data-toolbar-menu data-open="false">
    <span class="nth-tool-wrap" data-tooltip="More tools">
      <button class="nth-tool" type="button" aria-label="More tools" data-toolbar-menu-open aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5h.01"/><path d="M12 12h.01"/><path d="M12 19h.01"/></svg>
      </button>
    </span>
    ${languageMenuHtml(languagePath, htmlLang, preferredLanguage)}
  </div>
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
  const progressDetails = document.querySelector("[data-progress-details]");
  const progressToggle = document.querySelector("[data-progress-toggle]");
  const toolbarMenu = document.querySelector("[data-toolbar-menu]");
  const toolbarMenuOpen = document.querySelector("[data-toolbar-menu-open]");
  const setToolbarMenuOpen = (openMenu) => {
    toolbarMenu?.setAttribute("data-open", String(openMenu));
    toolbarMenuOpen?.setAttribute("aria-expanded", String(openMenu));
  };
  progressToggle?.addEventListener("click", () => {
    const isOpen = progressDetails?.getAttribute("data-open") === "true";
    progressDetails?.setAttribute("data-open", String(!isOpen));
    progressToggle.setAttribute("aria-expanded", String(!isOpen));
  });
  progressDetails?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      progressDetails.setAttribute("data-open", "false");
      progressToggle?.setAttribute("aria-expanded", "false");
    }
  });
  toolbarMenuOpen?.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = toolbarMenu?.getAttribute("data-open") === "true";
    setToolbarMenuOpen(!isOpen);
  });
  toolbarMenu?.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  toolbarMenu?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setToolbarMenuOpen(false);
      toolbarMenuOpen?.focus();
    }
  });
  document.addEventListener("click", () => setToolbarMenuOpen(false));
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

function languageMenuHtml(
  languagePath: string,
  htmlLang: "en" | "zh-CN",
  preferredLanguage: PageLanguage,
): string {
  const originalLabel = htmlLang === "zh-CN" ? "原文" : "Original";
  const options: Array<{ value: PageLanguage; label: string }> = [
    { value: "auto", label: originalLabel },
    { value: "en", label: "English" },
    { value: "zh-CN", label: "简体中文" },
    { value: "ja", label: "日本語" },
  ];

  return `<div class="nth-menu-panel" role="menu" aria-label="Language" data-language-menu>
      <strong>Language</strong>
      <form class="nth-language-options" action="${escapeAttribute(languagePath)}" method="post">
        ${options.map((option) => languageOptionHtml(option, preferredLanguage)).join("")}
      </form>
    </div>`;
}

function languageOptionHtml(
  option: { value: PageLanguage; label: string },
  preferredLanguage: PageLanguage,
): string {
  const selected = option.value === preferredLanguage;

  return `<button class="nth-language-option" type="submit" role="menuitem" name="language" value="${escapeAttribute(option.value)}" data-language-code="${escapeAttribute(option.value)}"${selected ? ' aria-current="true"' : ""}>${escapeHtml(option.label)}</button>`;
}

function toolbarProgressHtml(pageState: ServedPageState | undefined, freshness: string): string {
  const progress = normalizedProgress(pageState);
  const step = pageState?.generationStep || "Refreshing cached HTML";
  const label = pageState?.status === "failed" ? "Refresh failed" : `Refreshing ${progress}%`;

  return `<div class="nth-progress-details" data-progress-details tabindex="0" role="group" aria-label="Generation details">
    <button class="nth-freshness nth-progress-summary" type="button" title="${escapeAttribute(step)}" data-progress-toggle aria-expanded="false">
      <span>${escapeHtml(label)}</span>
      <span class="nth-mini-progress" aria-hidden="true"><span style="width:${progress}%"></span></span>
    </button>
    <div class="nth-progress-panel" role="status" aria-live="polite">
      <strong>Refreshing cached HTML</strong>
      <p>${escapeHtml(step)}</p>
      <div class="nth-progress"><span style="width:${progress}%"></span></div>
      ${generationLogHtml(pageState)}
      <small>${escapeHtml(freshness)}</small>
    </div>
  </div>`;
}

function generationLogHtml(pageState: ServedPageState | undefined): string {
  const log = normalizedGenerationLog(pageState);
  if (log.length === 0) return "";

  return `<ol class="nth-log-list">
    ${log.map((entry) => `<li>
      <time>${escapeHtml(formatLogTime(entry.at))}</time>
      <span>${escapeHtml(entry.step)}</span>
      <b>${entry.progress}%</b>
    </li>`).join("")}
  </ol>`;
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
    ${generationLogHtml(pageState)}
  </section></main>`;
}

function shouldAutoRefresh(pageState: ServedPageState | undefined): boolean {
  return pageState?.status === "queued" || pageState?.status === "generating";
}

function isGenerationActive(pageState: ServedPageState | undefined): boolean {
  return pageState?.status === "queued" || pageState?.status === "generating";
}

function hasGenerationLog(pageState: ServedPageState | undefined): boolean {
  return normalizedGenerationLog(pageState).length > 0 && pageState?.status === "failed";
}

function normalizedProgress(pageState: ServedPageState | undefined): number {
  const value = pageState?.generationProgress ?? 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizedGenerationLog(pageState: ServedPageState | undefined): GenerationLogEntry[] {
  const log = Array.isArray(pageState?.generationLog) ? pageState.generationLog : [];
  return log
    .filter((entry): entry is GenerationLogEntry => Boolean(
      entry &&
      typeof entry.at === "string" &&
      typeof entry.step === "string" &&
      typeof entry.progress === "number",
    ))
    .slice(-16);
}

function formatLogTime(value: string): string {
  const match = value.match(/T(\d{2}:\d{2}:\d{2})/);
  return match ? `${match[1]} UTC` : value;
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
.nth-progress-page .nth-log-list { max-width: 640px; margin-top: 24px; }
.nth-toolbar { position: fixed; right: 18px; bottom: 18px; display: flex; align-items: center; gap: 4px; padding: 4px; border: 1px solid #d4d4d4; border-radius: 8px; background: rgba(255,255,255,.96); box-shadow: 0 12px 34px rgba(0,0,0,.14); z-index: 50; }
.nth-freshness { height: 36px; display: inline-flex; align-items: center; padding: 0 10px; color: var(--muted); font-size: 12px; white-space: nowrap; border-right: 1px solid var(--line); }
.nth-progress-details { position: relative; }
.nth-progress-summary { min-width: 118px; display: grid; align-content: center; gap: 4px; border: 0; border-right: 1px solid var(--line); background: transparent; cursor: pointer; text-align: left; }
.nth-mini-progress { display: block; height: 3px; overflow: hidden; border-radius: 999px; background: var(--line); }
.nth-mini-progress span { display: block; height: 100%; border-radius: inherit; background: var(--fg); }
.nth-progress-panel { position: absolute; right: 0; bottom: calc(100% + 10px); width: 340px; padding: 14px; border: 1px solid #d4d4d4; border-radius: 8px; background: #fff; box-shadow: 0 18px 46px rgba(0,0,0,.18); opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(4px); transition: opacity .15s ease, transform .15s ease, visibility .15s ease; }
.nth-progress-details:hover .nth-progress-panel, .nth-progress-details:focus-within .nth-progress-panel, .nth-progress-details[data-open="true"] .nth-progress-panel { opacity: 1; visibility: visible; pointer-events: auto; transform: translateY(0); }
.nth-progress-panel strong { display: block; margin-bottom: 6px; font-size: 14px; }
.nth-progress-panel p { margin: 0 0 12px; color: var(--muted); font-size: 13px; line-height: 1.45; }
.nth-progress-panel small { display: block; margin-top: 10px; color: var(--muted); font-size: 12px; }
.nth-log-list { margin: 12px 0 0; padding: 10px 0 0; list-style: none; border-top: 1px solid var(--line); display: grid; gap: 8px; max-height: 220px; overflow: auto; }
.nth-log-list li { display: grid; grid-template-columns: 76px 1fr auto; gap: 8px; align-items: baseline; color: var(--fg); font-size: 12px; line-height: 1.35; }
.nth-log-list time { color: var(--muted); font-variant-numeric: tabular-nums; }
.nth-log-list span { min-width: 0; overflow-wrap: anywhere; }
.nth-log-list b { color: var(--muted); font-weight: 600; font-variant-numeric: tabular-nums; }
.nth-tool-wrap { position: relative; display: inline-grid; place-items: center; }
.nth-tool-wrap::after { content: attr(data-tooltip); position: absolute; right: 0; bottom: calc(100% + 8px); pointer-events: none; opacity: 0; transform: translateY(4px); transition: opacity .15s ease, transform .15s ease; white-space: nowrap; border: 1px solid #d4d4d4; border-radius: 6px; background: var(--fg); color: #fff; padding: 6px 8px; font-size: 12px; box-shadow: 0 8px 18px rgba(0,0,0,.14); }
.nth-tool-wrap:hover::after, .nth-tool-wrap:focus-within::after { opacity: 1; transform: translateY(0); }
.nth-toolbar-menu { position: relative; display: inline-grid; place-items: center; }
.nth-tool { width: 36px; height: 36px; border: 0; border-radius: 6px; color: var(--fg); background: transparent; display: grid; place-items: center; cursor: pointer; }
.nth-tool:hover { background: var(--soft); }
.nth-tool svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.nth-menu-panel { position: absolute; right: 0; bottom: calc(100% + 10px); width: 220px; padding: 10px; border: 1px solid #d4d4d4; border-radius: 8px; background: #fff; box-shadow: 0 18px 46px rgba(0,0,0,.18); opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(4px); transition: opacity .15s ease, transform .15s ease, visibility .15s ease; }
.nth-toolbar-menu[data-open="true"] .nth-menu-panel { opacity: 1; visibility: visible; pointer-events: auto; transform: translateY(0); }
.nth-menu-panel strong { display: block; padding: 2px 4px 8px; color: var(--muted); font-size: 12px; line-height: 1.3; }
.nth-language-options { display: grid; gap: 2px; }
.nth-language-option { width: 100%; min-height: 34px; padding: 0 9px; border: 0; border-radius: 6px; background: transparent; color: var(--fg); cursor: pointer; font: inherit; font-size: 13px; text-align: left; }
.nth-language-option:hover { background: var(--soft); }
.nth-language-option[aria-current="true"] { color: var(--muted); background: var(--soft); }
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
@media (max-width: 640px) { .nth-document { width: min(100% - 28px, 860px); padding-top: 24px; } .nth-freshness { max-width: 116px; overflow: hidden; text-overflow: ellipsis; } .nth-progress-panel, .nth-menu-panel { width: min(340px, calc(100vw - 36px)); } .nth-log-list li { grid-template-columns: 1fr auto; } .nth-log-list time { display: none; } }
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
