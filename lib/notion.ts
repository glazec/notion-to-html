import { optionalEnv, requireEnv } from "@/lib/env";

export type NotionSource = {
  pageId: string;
  url: string;
  markdown: string;
};

const uuidPattern =
  /[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}/;

export function parseNotionPageId(input: string): string {
  const decoded = decodeURIComponent(input.trim());
  const match = decoded.match(uuidPattern);

  if (!match) {
    throw new Error("Could not find a Notion page id in the URL.");
  }

  return formatNotionId(match[0]);
}

export function slugFromNotionUrl(input: string): string {
  const pageId = parseNotionPageId(input);

  try {
    const url = new URL(input);
    const lastSegment = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "");
    const withoutId = lastSegment
      .replace(new RegExp(`-?${pageId.replaceAll("-", "")}$`, "i"), "")
      .replace(new RegExp(`-?${pageId}$`, "i"), "");
    const slug = cleanSlug(withoutId);
    if (slug) return slug;
  } catch {
    // Fall through to the stable id based key.
  }

  return pageId.replaceAll("-", "").slice(0, 14);
}

export function isNotionUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "notion.so" ||
      host.endsWith(".notion.so") ||
      host === "notion.site" ||
      host.endsWith(".notion.site") ||
      host === "notion.com" ||
      host.endsWith(".notion.com");
  } catch {
    return false;
  }
}

export function formatNotionId(id: string): string {
  const compact = id.replaceAll("-", "").toLowerCase();

  if (!/^[0-9a-f]{32}$/.test(compact)) {
    throw new Error("Invalid Notion page id.");
  }

  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ].join("-");
}

function cleanSlug(value: string): string {
  return value
    .trim()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

export async function fetchNotionMarkdown(notionUrl: string): Promise<NotionSource> {
  const pageId = parseNotionPageId(notionUrl);
  const token = requireEnv("NOTION_API_KEY");
  const notionVersion = optionalEnv("NOTION_VERSION") ?? "2026-03-11";

  const response = await fetch(`https://api.notion.com/v1/pages/${pageId}/markdown`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": notionVersion,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Notion markdown fetch failed: ${response.status} ${body}`);
  }

  const payload = (await response.json()) as {
    markdown?: string;
    truncated?: boolean;
    unknown_block_ids?: string[];
  };

  if (!payload.markdown) {
    throw new Error("Notion markdown response did not include markdown.");
  }

  return {
    pageId,
    url: notionUrl,
    markdown: payload.markdown,
  };
}
