import { requireEnv } from "@/lib/env";
import { isNotionUrl, parseNotionPageId } from "@/lib/notion";

export type FirecrawlSource = {
  pageId: string;
  url: string;
  markdown: string;
};

type FirecrawlScrapeResponse = {
  success?: boolean;
  data?: {
    markdown?: string;
    links?: string[];
    images?: string[] | { url?: string }[];
    metadata?: {
      title?: string;
      sourceURL?: string;
    };
  };
  error?: string;
};

export async function fetchPublicNotionContent(notionUrl: string): Promise<FirecrawlSource> {
  const pageId = parseNotionPageId(notionUrl);
  const token = requireEnv("FIRECRAWL_API_KEY");

  const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: notionUrl,
      formats: ["markdown", "links", "images"],
      onlyMainContent: true,
      waitFor: 1000,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as FirecrawlScrapeResponse;

  if (!response.ok || payload.success === false) {
    throw new Error(`Firecrawl scrape failed: ${response.status} ${payload.error ?? ""}`.trim());
  }

  const markdown = payload.data?.markdown?.trim();
  if (!markdown) {
    throw new Error("Firecrawl scrape response did not include markdown.");
  }

  if (isNotionSignInPage(markdown)) {
    throw new Error("Firecrawl returned a Notion sign-in page instead of page content.");
  }

  return {
    pageId,
    url: payload.data?.metadata?.sourceURL ?? notionUrl,
    markdown: enrichMarkdown(markdown, payload.data?.links ?? [], payload.data?.images ?? []),
  };
}

function isNotionSignInPage(markdown: string): boolean {
  const normalized = markdown.toLowerCase();
  return normalized.includes("sign in to see this page") ||
    (
      normalized.includes("you’re almost there") &&
      normalized.includes("email") &&
      normalized.includes("continue") &&
      normalized.includes("new user?")
    );
}

function enrichMarkdown(
  markdown: string,
  links: string[],
  images: string[] | { url?: string }[],
): string {
  const relatedNotionLinks = unique(
    links.filter((link) => isNotionUrl(link) && !markdown.includes(link)),
  ).slice(0, 20);
  const imageUrls = unique(
    images
      .map((image) => typeof image === "string" ? image : image.url ?? "")
      .filter((url) => /^https?:\/\//i.test(url) && !markdown.includes(url)),
  ).slice(0, 20);
  const additions: string[] = [];

  if (relatedNotionLinks.length > 0) {
    additions.push(
      [
        "## Mentioned Notion pages",
        ...relatedNotionLinks.map((link) => `- [${link}](${link})`),
      ].join("\n"),
    );
  }

  if (imageUrls.length > 0) {
    additions.push(
      [
        "## Images",
        ...imageUrls.map((url, index) => `![Image ${index + 1}](${url})`),
      ].join("\n"),
    );
  }

  return [markdown, ...additions].join("\n\n");
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
