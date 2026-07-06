import type { PublicNotionDatabase, PublicNotionDatabaseRow } from "@/lib/notion-database";

export function renderNotionDatabaseHtmlBody(database: PublicNotionDatabase): string {
  const rows = database.rows;
  const categoryCounts = countBy(rows, (row) => row.category || "uncategorized");
  const categories = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const rowsWithUrls = rows.filter((row) => row.productUrl).length;
  const rowsWithDescriptions = rows.filter((row) => row.description).length;
  const featuredRows = rows.slice(0, 6);
  const rowCountLabel = database.truncated ? `First ${rows.length}` : String(rows.length);

  return `<style data-document-to-html>
:root {
  --bg: oklch(.987 .005 78);
  --surface: oklch(.967 .006 78);
  --surface2: oklch(.945 .008 78);
  --border: oklch(.885 .008 72);
  --border-strong: oklch(.80 .010 72);
  --text: oklch(.255 .013 60);
  --text-soft: oklch(.435 .012 62);
  --muted: oklch(.58 .010 62);
  --accent: oklch(.575 .185 33);
  --accent-ink: oklch(.48 .19 33);
  --accent-soft: oklch(.955 .035 44);
  --mono: "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace;
  --sans: "Archivo", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Helvetica Neue", sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body { background: var(--bg); color: var(--text); font-family: var(--sans); line-height: 1.68; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 64px 40px 80px; }
.hero { padding: 46px 0 56px; border-bottom: 1px solid var(--text); }
.brand, .sec-label, nav a, .pill, .chip, .source-link, .count, .footer { font-family: var(--mono); }
.brand { color: var(--accent-ink); font-size: 12px; font-weight: 700; letter-spacing: .06em; margin-bottom: 22px; text-transform: uppercase; }
h1 { font-size: 46px; line-height: 1.08; font-weight: 760; letter-spacing: 0; max-width: 860px; margin-bottom: 18px; }
h2 { font-size: 30px; line-height: 1.18; letter-spacing: 0; }
h3 { font-size: 19px; line-height: 1.3; letter-spacing: 0; margin-bottom: 10px; }
a { color: var(--accent-ink); text-decoration: none; }
a:hover { text-decoration: underline; }
code { background: var(--surface2); border: 1px solid var(--border); border-radius: 4px; font-family: var(--mono); font-size: .88em; padding: 1px 5px; }
.hero-tagline { color: var(--text-soft); font-size: 19px; line-height: 1.52; max-width: 800px; }
.source-line { color: var(--muted); font-size: 13px; margin-top: 22px; max-width: 850px; overflow-wrap: anywhere; }
nav { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 24px; }
nav a, .pill { background: var(--surface2); border: 1px solid var(--border); border-radius: 999px; color: var(--muted); display: inline-block; font-size: 11px; letter-spacing: .04em; padding: 3px 9px; text-transform: uppercase; white-space: nowrap; }
nav a:hover { border-color: var(--accent); color: var(--accent-ink); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 18px; margin-top: 28px; }
.stat { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 20px; text-align: center; }
.stat:first-child { background: linear-gradient(180deg, var(--accent-soft), var(--surface)); border-color: var(--accent); }
.stat strong { color: var(--text); display: block; font-family: var(--mono); font-size: 32px; font-variant-numeric: tabular-nums; font-weight: 760; line-height: 1.1; }
.stat:first-child strong { color: var(--accent-ink); }
.stat span { color: var(--muted); display: block; font-size: 12.5px; margin-top: 6px; }
section { border-bottom: 1px solid var(--border); padding: 54px 0; }
.shead { align-items: baseline; display: flex; gap: 14px; margin-bottom: 14px; }
.sec-label { color: var(--accent-ink); font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.lede { color: var(--text-soft); font-size: 16.5px; margin-bottom: 30px; max-width: 820px; }
.grid { align-items: start; display: grid; gap: 18px; grid-template-columns: 1.05fr .95fr; }
.panel, .note { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 24px; }
.panel p, .note { color: var(--text-soft); font-size: 14.5px; }
.note { border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0; margin-top: 22px; }
.bar-list { display: grid; gap: 10px; }
.bar-row { align-items: center; display: grid; font-size: 14px; gap: 12px; grid-template-columns: 126px 1fr 44px; }
.bar-row span { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-row strong { color: var(--muted); font: 700 13px/1 var(--mono); text-align: right; }
.bar-track { background: var(--surface2); border-radius: 6px; height: 12px; overflow: hidden; }
.bar-fill { background: var(--accent); border-radius: 6px; height: 100%; }
.controls { align-items: center; display: grid; gap: 12px; grid-template-columns: 1fr 220px auto; margin: 18px 0; }
.controls input, .controls select { background: var(--surface); border: 1px solid var(--border-strong); border-radius: 8px; color: var(--text); font: inherit; padding: 11px 12px; width: 100%; }
.count { color: var(--muted); font-size: 12px; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }
.table-shell { background: color-mix(in oklch, var(--surface) 65%, transparent); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 26px; overflow-x: auto; }
table { border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; min-width: 940px; width: 100%; }
thead th { background: var(--surface2); border-bottom: 2px solid var(--border); color: var(--muted); font-family: var(--mono); font-size: 11px; font-weight: 700; letter-spacing: .05em; padding: 12px 14px; text-align: left; text-transform: uppercase; }
tbody td { border-bottom: 1px solid var(--border); color: var(--text-soft); padding: 14px; vertical-align: top; }
tbody tr:hover { background: var(--surface); }
.num { color: var(--muted); font-family: var(--mono); font-size: 12px; width: 54px; }
.name-cell { min-width: 200px; }
.entry-title, .featured-title { color: var(--text); display: block; font-weight: 760; line-height: 1.3; overflow-wrap: anywhere; }
.source-link { color: var(--muted); display: inline-block; font-size: 11px; letter-spacing: .03em; margin-top: 6px; text-transform: uppercase; }
.desc-cell { color: var(--text-soft); max-width: 560px; min-width: 320px; overflow-wrap: anywhere; }
.md { display: grid; gap: 8px; }
.md p { margin: 0; overflow-wrap: anywhere; }
.md h4 { color: var(--text); font-size: 15px; line-height: 1.35; }
.md ul, .md ol { display: grid; gap: 4px; margin: 0; padding-left: 20px; }
.md strong { color: var(--text); }
.empty-text { color: var(--muted); }
.desc-cell details { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.desc-cell details[open] { border-color: var(--accent); }
.desc-cell details > summary { color: var(--text); cursor: pointer; list-style: none; overflow-wrap: anywhere; padding: 12px 14px; user-select: none; }
.desc-cell details > summary::-webkit-details-marker { display: none; }
.desc-cell details[open] > summary { background: var(--accent-soft); border-bottom: 1px solid var(--border); color: var(--accent-ink); }
.desc-cell details .md { padding: 14px; }
.chip { background: var(--surface2); border-radius: 999px; color: var(--muted); display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: .05em; margin: 2px 4px 2px 0; padding: 4px 10px; text-transform: uppercase; }
.product-link { overflow-wrap: anywhere; }
.empty { color: var(--text-soft); display: none; padding: 20px; }
.footer { color: var(--muted); font-size: 11.5px; letter-spacing: .06em; padding-top: 32px; text-align: center; text-transform: uppercase; }
@media (max-width: 860px) {
  .wrap { padding: 40px 20px 60px; }
  h1 { font-size: 34px; }
  .hero-tagline { font-size: 17px; }
  .grid, .controls { grid-template-columns: 1fr; }
  .shead { display: block; }
  .table-shell { overflow-x: visible; }
  table { min-width: 0; }
  thead { display: none; }
  tbody tr { border-bottom: 1px solid var(--border); display: block; padding: 10px 0; }
  tbody td { border-bottom: 0; display: grid; gap: 12px; grid-template-columns: minmax(92px, 32%) 1fr; padding: 9px 14px; }
  tbody td::before { color: var(--muted); content: attr(data-label); font-family: var(--mono); font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
  .num { width: auto; }
  .name-cell, .desc-cell { max-width: none; min-width: 0; }
}
</style>
<main class="document-html-page wrap">
  <header class="hero" id="top">
    <div class="brand">${escapeHtml(database.title)} · Notion database</div>
    <h1>${escapeHtml(database.title)}</h1>
    <p class="hero-tagline">This page keeps the landing context and renders every row fetched from the public Notion collection view.</p>
    <p class="source-line">Source: <a href="${escapeAttribute(database.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(database.sourceUrl)}</a></p>
    <nav aria-label="Page sections">
      <a href="#overview">Overview</a>
      <a href="#featured">First rows</a>
      <a href="#entries">All entries</a>
      <a href="#categories">Categories</a>
    </nav>
    <div class="stats" aria-label="Database stats">
      <div class="stat"><strong>${escapeHtml(rowCountLabel)}</strong><span>${database.truncated ? "Rows fetched before Notion reported more" : "Notion rows fetched"}</span></div>
      <div class="stat"><strong>${rowsWithUrls}</strong><span>Rows with product URLs</span></div>
      <div class="stat"><strong>${rowsWithDescriptions}</strong><span>Rows with descriptions</span></div>
      <div class="stat"><strong>${categories.length}</strong><span>Categories</span></div>
    </div>
  </header>

  <section id="overview">
    <div class="shead"><span class="sec-label">01 · OVERVIEW</span><h2>Database view</h2></div>
    <p class="lede">The source is a public Notion database. This generated page uses the collection row ids from the selected table view, so the landing stays readable while the full database remains available below.</p>
    <div class="grid">
      <div class="panel">
        <h3>Generation rule</h3>
        <p>Every row returned by the collection query is rendered in the full table. Row titles point to the generated HTML subpage route, the Notion row link keeps the original source, and external product links stay in their own column.</p>
      </div>
      <div class="panel" id="categories">
        <h3>Category counts</h3>
        <div class="bar-list">${renderCategoryBars(categories)}</div>
      </div>
    </div>
    <div class="note">${database.truncated ? `This public collection query returned ${rows.length} rows and reported more rows available. Narrow the source view or add an authenticated export path for databases above this size.` : "Images and icons from Notion are treated as assets. They are not classified as database entries or subpages."}</div>
  </section>

  <section id="featured">
    <div class="shead"><span class="sec-label">02 · VIEW ORDER</span><h2>First rows from the source view</h2></div>
    <p class="lede">These rows follow the current Notion table order. Use them as a quick scan before moving into the full database.</p>
    <div class="table-shell">
      <table>
        <thead><tr><th>Name</th><th>Description</th><th>Product URL</th><th>Category</th><th>Created</th></tr></thead>
        <tbody>${featuredRows.map(renderFeaturedRow).join("\n")}</tbody>
      </table>
    </div>
  </section>

  <section id="entries">
    <div class="shead"><span class="sec-label">03 · DATABASE</span><h2>All entries</h2></div>
    <p class="lede">This table renders ${database.truncated ? `the first ${rows.length}` : `all ${rows.length}`} fetched database rows.</p>
    <div class="controls" role="search">
      <input id="search" type="search" placeholder="Search name, description, URL, or category" autocomplete="off">
      <select id="category">${renderCategoryOptions(rows.length, categories)}</select>
      <div class="count"><span id="visible-count">${rows.length}</span> visible</div>
    </div>
    <div class="table-shell">
      <table id="entries-table">
        <thead><tr><th>#</th><th>Name</th><th>Description</th><th>Category</th><th>Product URL</th><th>Created</th></tr></thead>
        <tbody>${rows.map((row, index) => renderEntryRow(row, index)).join("\n")}</tbody>
      </table>
      <div class="empty" id="empty-state">No matching entries.</div>
    </div>
  </section>

  <div class="footer">Generated from Notion collection view ${escapeHtml(database.viewId)}</div>
</main>
<script>
(() => {
  const search = document.getElementById("search");
  const category = document.getElementById("category");
  const rows = Array.from(document.querySelectorAll("#entries-table tbody tr"));
  const count = document.getElementById("visible-count");
  const empty = document.getElementById("empty-state");
  const apply = () => {
    const term = String(search.value || "").trim().toLowerCase();
    const selected = String(category.value || "all");
    let visible = 0;
    for (const row of rows) {
      const categoryMatch = selected === "all" || row.dataset.category === selected;
      const searchMatch = !term || String(row.dataset.search || "").includes(term);
      const show = categoryMatch && searchMatch;
      row.style.display = show ? "" : "none";
      if (show) visible += 1;
    }
    count.textContent = String(visible);
    empty.style.display = visible === 0 ? "block" : "none";
  };
  search.addEventListener("input", apply);
  category.addEventListener("change", apply);
})();
</script>`;
}

function renderCategoryBars(categories: [string, number][]): string {
  if (categories.length === 0) {
    return `<p class="empty-text">No categories found.</p>`;
  }

  const max = Math.max(...categories.map(([, count]) => count));
  return categories
    .map(([category, count]) => {
      const width = max === 0 ? 0 : Math.max(4, Math.round((count / max) * 100));
      return `<div class="bar-row"><span>${escapeHtml(category)}</span><div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div><strong>${count}</strong></div>`;
    })
    .join("\n");
}

function renderCategoryOptions(total: number, categories: [string, number][]): string {
  return [
    `<option value="all">All categories (${total})</option>`,
    ...categories.map(([category, count]) => (
      `<option value="${escapeAttribute(category)}">${escapeHtml(category)} (${count})</option>`
    )),
  ].join("\n");
}

function renderFeaturedRow(row: PublicNotionDatabaseRow): string {
  return `<tr>
  <td data-label="Name"><a class="featured-title" href="${escapeAttribute(generatedPageHref(row.rowUrl))}">${escapeHtml(row.title)}</a></td>
  <td class="desc-cell" data-label="Description">${renderDescription(row.description)}</td>
  <td data-label="Product URL">${renderProductLink(row.productUrl)}</td>
  <td data-label="Category"><span class="chip">${escapeHtml(row.category)}</span></td>
  <td data-label="Created">${escapeHtml(formatDate(row.createdTime))}</td>
</tr>`;
}

function renderEntryRow(row: PublicNotionDatabaseRow, index: number): string {
  const searchText = [
    row.title,
    searchableText(row.description),
    row.productUrl,
    row.category,
  ].join(" ").toLowerCase();

  return `<tr data-category="${escapeAttribute(row.category)}" data-search="${escapeAttribute(searchText)}">
  <td class="num" data-label="#">${index + 1}</td>
  <td class="name-cell" data-label="Name"><a class="entry-title" href="${escapeAttribute(generatedPageHref(row.rowUrl))}">${escapeHtml(row.title)}</a><a class="source-link" href="${escapeAttribute(row.rowUrl)}" target="_blank" rel="noreferrer">Notion row</a></td>
  <td class="desc-cell" data-label="Description">${renderDescription(row.description)}</td>
  <td data-label="Category"><span class="chip">${escapeHtml(row.category)}</span></td>
  <td data-label="Product URL">${renderProductLink(row.productUrl)}</td>
  <td data-label="Created">${escapeHtml(formatDate(row.createdTime))}</td>
</tr>`;
}

function renderDescription(description: string): string {
  if (!description.trim()) {
    return `<span class="empty-text">No description</span>`;
  }

  const markdown = `<div class="md">${renderMarkdownBlocks(description)}</div>`;
  if (description.length <= 260) return markdown;

  return `<details><summary>${escapeHtml(excerpt(description))}</summary>${markdown}</details>`;
}

function renderMarkdownBlocks(value: string): string {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let codeLines: string[] = [];
  let inCode = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(`<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };
  const flushCode = () => {
    if (codeLines.length === 0) return;
    blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeLines = [];
  };

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push(`<h4>${renderInlineMarkdown(heading[1])}</h4>`);
      continue;
    }

    const bullet = trimmed.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      listItems.push(bullet[1]);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushCode();

  return blocks.length > 0 ? blocks.join("") : `<p>${renderInlineMarkdown(value)}</p>`;
}

function renderInlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label: string, url: string) => {
      return `<a href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function renderProductLink(productUrl: string): string {
  if (!productUrl) return `<span class="empty-text">No URL</span>`;
  const href = externalHref(productUrl);
  if (!href) return `<span class="product-link">${escapeHtml(productUrl)}</span>`;

  return `<a class="product-link" href="${escapeAttribute(href)}" target="_blank" rel="noreferrer">${escapeHtml(readableUrlLabel(href))}</a>`;
}

function externalHref(value: string): string | null {
  try {
    return new URL(value).toString();
  } catch {
    try {
      return new URL(`https://${value}`).toString();
    } catch {
      return null;
    }
  }
}

function readableUrlLabel(value: string): string {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    const label = `${host}${path}`.slice(0, 70);
    return label || value;
  } catch {
    return value;
  }
}

function generatedPageHref(notionUrl: string): string {
  return `/api/pages?notionUrl=${encodeURIComponent(notionUrl)}`;
}

function formatDate(value: number | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function excerpt(value: string): string {
  const text = searchableText(value)
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 150 ? `${text.slice(0, 147)}...` : text;
}

function searchableText(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*`#>]+/g, "")
    .trim();
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
