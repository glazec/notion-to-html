import { fetchPublicNotionContent } from "@/lib/firecrawl";
import { optionalEnv } from "@/lib/env";
import { fetchNotionCommentsMarkdown, fetchNotionMarkdown, parseNotionPageId } from "@/lib/notion";

export type ContentSource = {
  pageId: string;
  url: string;
  markdown: string;
  sourceName: "Notion API" | "Firecrawl";
  commentCount: number;
  discussionCount: number;
  warning?: string;
};

export const inaccessibleNotionPageMessage = "Notion page is not accessible. No website was generated. To fix it: open the page in Notion, click Share, publish it to web, or share it with the configured Notion integration and ensure the page id is in NOTION_PUBLIC_NOTION_API_PAGE_ALLOWLIST. Then regenerate.";

export async function fetchSourceContent(notionUrl: string): Promise<ContentSource> {
  if (shouldUseNotionApiForPage(notionUrl)) {
    const source = await fetchNotionMarkdown(notionUrl).catch((error) => {
      if (isNotionApiAccessError(error)) {
        throw new Error(inaccessibleNotionPageMessage);
      }
      throw error;
    });
    const comments = await fetchNotionCommentsMarkdown(notionUrl).catch(() => ({
      markdown: "",
      commentCount: 0,
      discussionCount: 0,
      truncated: false,
    }));

    return {
      ...source,
      markdown: comments.markdown ? `${source.markdown}\n\n${comments.markdown}` : source.markdown,
      sourceName: "Notion API",
      commentCount: comments.commentCount,
      discussionCount: comments.discussionCount,
    };
  }

  return {
    ...(await fetchPublicNotionContent(notionUrl).catch((error) => {
      if (isPublicNotionAccessError(error)) {
        throw new Error(inaccessibleNotionPageMessage);
      }
      throw error;
    })),
    sourceName: "Firecrawl",
    commentCount: 0,
    discussionCount: 0,
  };
}

function isPublicNotionAccessError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes("notion sign-in page");
}

function isNotionApiAccessError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes("notion markdown fetch failed: 403") ||
    message.includes("notion markdown fetch failed: 404");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shouldUseNotionApiForPage(notionUrl: string): boolean {
  if (!optionalEnv("NOTION_API_KEY")) return false;

  const allowlist = optionalEnv("NOTION_PUBLIC_NOTION_API_PAGE_ALLOWLIST");
  if (!allowlist) return false;

  const pageId = parseNotionPageId(notionUrl).replaceAll("-", "").toLowerCase();
  return allowlist
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .some((entry) => normalizedAllowlistPageId(entry) === pageId);
}

function normalizedAllowlistPageId(entry: string): string | null {
  try {
    return parseNotionPageId(entry).replaceAll("-", "").toLowerCase();
  } catch {
    const compact = entry.replaceAll("-", "").toLowerCase();
    return /^[0-9a-f]{32}$/.test(compact) ? compact : null;
  }
}
