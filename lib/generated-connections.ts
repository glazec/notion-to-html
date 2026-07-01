import { isNotionUrl } from "@/lib/notion";

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

export function preserveGeneratedConnections(html: string, sourceMarkdown: string): string {
  const rewritten = rewriteNotionHrefAttributes(html);
  const additions = [
    missingImagesHtml(rewritten, sourceMarkdown),
    missingNotionLinksHtml(rewritten, sourceMarkdown),
  ].filter(Boolean).join("\n");

  if (!additions) return rewritten;

  const mainEnd = rewritten.lastIndexOf("</main>");
  if (mainEnd === -1) return `${rewritten}\n${additions}`;
  return `${rewritten.slice(0, mainEnd)}\n${additions}\n${rewritten.slice(mainEnd)}`;
}

function rewriteNotionHrefAttributes(html: string): string {
  return html.replace(/\shref=(["'])(https?:\/\/[^"']*notion[^"']*)\1/gi, (match, quote: string, url: string) => {
    if (!isNotionUrl(url)) return match;
    return ` href=${quote}${localNotionHref(url)}${quote}`;
  });
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
    ${links.map((link) => `<p><a href="${escapeAttribute(localNotionHref(link.url))}">${escapeHtml(link.label)}</a></p>`).join("\n")}
  </div>
</section>`;
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
    .map((match) => ({
      label: match[1]?.trim() || match[2],
      url: match[2],
    }))
    .filter((link) => isNotionUrl(link.url));
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
