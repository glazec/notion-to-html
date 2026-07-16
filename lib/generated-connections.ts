import { isNotionUrl, parseNotionPageId } from "@/lib/notion";

type MarkdownImageConnection = {
  alt: string;
  localUrl: string;
  description: string;
};

type NotionLinkConnection = {
  label: string;
  url: string;
};

const markdownImagePattern = /!\[([^\]]*)\]\((\/assets\/[^)\s]+)\)(?:\s+Codex image description:\s*([^\n]+))?/g;
const localImageLinePattern = /### Image \d+:\s*([^\n]+)\nLocal image:\s*(\/assets\/[^\n]+)\nOriginal image:\s*([^\n]+)\nCodex image description:\s*([^\n]+)/g;
const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
const emojiPattern = /(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0E|\uFE0F)?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}(?:\uFE0E|\uFE0F)?\p{Emoji_Modifier}?)*)/gu;

export function preserveGeneratedConnections(
  html: string,
  sourceMarkdown: string,
  sourceNotionUrl?: string,
): string {
  const rewritten = rewriteNotionHrefAttributes(html, sourceNotionUrl);
  const additions = [
    missingImagesHtml(rewritten, sourceMarkdown),
    missingNotionLinksHtml(rewritten, sourceMarkdown),
  ].filter(Boolean).join("\n");

  if (!additions) return rewritten;

  const mainEnd = rewritten.lastIndexOf("</main>");
  if (mainEnd === -1) return `${rewritten}\n${additions}`;
  return `${rewritten.slice(0, mainEnd)}\n${additions}\n${rewritten.slice(mainEnd)}`;
}

function rewriteNotionHrefAttributes(html: string, sourceNotionUrl?: string): string {
  return html.replace(/\shref=(["'])(https?:\/\/[^"']*notion[^"']*)\1/gi, (match, quote: string, url: string) => {
    if (!isRoutableNotionPageUrl(url)) return match;
    if (sourceNotionUrl && isSameNotionPage(url, sourceNotionUrl)) return match;
    return ` href=${quote}${localNotionHref(url)}${quote}`;
  });
}

function isSameNotionPage(url: string, sourceNotionUrl: string): boolean {
  try {
    return normalizePageId(parseNotionPageId(url)) === normalizePageId(parseNotionPageId(sourceNotionUrl));
  } catch {
    return false;
  }
}

function normalizePageId(pageId: string): string {
  return pageId.replaceAll("-", "").toLowerCase();
}

function missingImagesHtml(html: string, markdown: string): string {
  const images = extractImageConnections(markdown)
    .filter((image) => !html.includes(image.localUrl) || !html.includes(image.description));
  if (images.length === 0) return "";

  return `<section class="visual-assets">
  <div class="shead"><span class="sec-label">VISUAL SOURCES</span><h2>Source visuals are preserved</h2></div>
  <div class="geo-grid">
    ${images.map((image) => `<figure class="geo">
      <img src="${escapeAttribute(image.localUrl)}" alt="${escapeAttribute(image.alt)}" loading="lazy" />
      <figcaption><b>${escapeHtml(image.alt)}</b><br>${escapeHtml(image.description)}</figcaption>
    </figure>`).join("\n")}
  </div>
</section>`;
}

function missingNotionLinksHtml(html: string, markdown: string): string {
  const links = uniqueLinks(extractNotionLinks(markdown))
    .filter((link) => !html.includes(localNotionHref(link.url)) && !html.includes(link.url));
  if (links.length === 0) return "";

  return `<section class="linked-pages">
  <div class="shead"><span class="sec-label">LINKED PAGES</span><h2>Connected Notion pages are preserved</h2></div>
  <div class="story">
    ${links.map((link) => `<p><a href="${escapeAttribute(localNotionHref(link.url))}">${escapeHtml(referenceLabel(link))}</a></p>`).join("\n")}
  </div>
</section>`;
}

function referenceLabel(link: NotionLinkConnection): string {
  return link.label.replace(emojiPattern, "").replace(/\s+/g, " ").trim() || link.url;
}

function extractImageConnections(markdown: string): MarkdownImageConnection[] {
  const fromImageBlocks = [...markdown.matchAll(markdownImagePattern)]
    .map((match) => ({
      alt: match[1]?.trim() || "Image",
      localUrl: match[2],
      description: match[3]?.trim() || match[1]?.trim() || "Source image from the Notion page.",
    }));

  const fromAssetSection = [...markdown.matchAll(localImageLinePattern)]
    .map((match) => ({
      alt: match[1]?.trim() || "Image",
      localUrl: match[2],
      description: match[4]?.trim() || "Source image from the Notion page.",
    }));

  const seen = new Set<string>();
  return [...fromImageBlocks, ...fromAssetSection].filter((image) => {
    if (seen.has(image.localUrl)) return false;
    seen.add(image.localUrl);
    return true;
  });
}

function extractNotionLinks(markdown: string): NotionLinkConnection[] {
  return [...markdown.matchAll(markdownLinkPattern)]
    .filter((match) => markdown[(match.index ?? 0) - 1] !== "!")
    .map((match) => ({
      label: match[1]?.trim() || match[2],
      url: match[2],
    }))
    .filter((link) => isRoutableNotionPageUrl(link.url, link.label));
}

function uniqueLinks(links: NotionLinkConnection[]): NotionLinkConnection[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    if (seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

function localNotionHref(url: string): string {
  return `/api/pages?notionUrl=${encodeURIComponent(url)}`;
}

function isRoutableNotionPageUrl(url: string, label = ""): boolean {
  if (!isNotionUrl(url) || isNotionUtilityUrl(url, label)) return false;

  try {
    parseNotionPageId(url);
    return true;
  } catch {
    return false;
  }
}

function isNotionUtilityUrl(url: string, label: string): boolean {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    if (pathname.startsWith("/icons/") || pathname.startsWith("/images/")) return true;
    return parsed.hash.toLowerCase() === "#main" && label.toLowerCase().includes("skip");
  } catch {
    return false;
  }
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
