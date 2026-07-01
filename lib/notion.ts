import { optionalEnv, requireEnv } from "@/lib/env";

export type NotionSource = {
  pageId: string;
  url: string;
  markdown: string;
};

export type NotionCommentsSource = {
  markdown: string;
  commentCount: number;
  discussionCount: number;
  truncated: boolean;
};

const uuidPatternSource =
  "[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}";
const uuidPattern = new RegExp(uuidPatternSource);
const uuidGlobalPattern = new RegExp(uuidPatternSource, "g");
const maxCommentBlocks = 300;

export function parseNotionPageId(input: string): string {
  const decoded = decodeURIComponent(input.trim());
  const parsed = notionPageIdFromUrl(decoded);
  if (parsed) return parsed.pageId;

  const match = uuidMatches(decoded).at(-1);

  if (!match) {
    throw new Error("Could not find a Notion page id in the URL.");
  }

  return formatNotionId(match);
}

export function slugFromNotionUrl(input: string): string {
  const pageId = parseNotionPageId(input);

  try {
    const url = new URL(input);
    const parsed = notionPageIdFromUrl(input);
    if (parsed?.source === "query") {
      return pageId.replaceAll("-", "").slice(0, 14);
    }

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

function notionPageIdFromUrl(input: string): { pageId: string; source: "path" | "query" } | null {
  try {
    const url = new URL(input);
    const queryPageId = url.searchParams.get("p")?.match(uuidPattern)?.[0];
    if (queryPageId) {
      return { pageId: formatNotionId(queryPageId), source: "query" };
    }

    const pathPageId = uuidMatches(decodeURIComponent(url.pathname)).at(-1);
    if (pathPageId) {
      return { pageId: formatNotionId(pathPageId), source: "path" };
    }
  } catch {
    return null;
  }

  return null;
}

function uuidMatches(value: string): string[] {
  return [...value.matchAll(uuidGlobalPattern)].map((match) => match[0]);
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

export function notionUrlFromPathSegments(segments: string[]): string | null {
  const rawPath = segments
    .map((segment) => decodeURIComponent(segment))
    .join("/")
    .trim();

  if (!rawPath) return null;

  const candidate = normalizePastedUrlPath(rawPath);
  if (!isNotionUrl(candidate)) return null;

  try {
    parseNotionPageId(candidate);
    return candidate;
  } catch {
    return null;
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

function normalizePastedUrlPath(value: string): string {
  const withScheme = value
    .replace(/^https:\/*/i, "https://")
    .replace(/^http:\/*/i, "http://");

  if (/^https?:\/\//i.test(withScheme)) return withScheme;
  if (/^(?:app\.notion\.com|www\.notion\.so|notion\.so|notion\.site|notion\.com)\//i.test(withScheme)) {
    return `https://${withScheme}`;
  }

  return withScheme;
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
  const response = await notionApiFetch(`pages/${pageId}/markdown`);

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

export async function fetchNotionCommentsMarkdown(notionUrl: string): Promise<NotionCommentsSource> {
  const pageId = parseNotionPageId(notionUrl);
  const targets = await collectCommentTargets(pageId);
  const discussions = new Map<string, {
    context: string;
    comments: {
      id: string;
      createdTime: string;
      text: string;
    }[];
  }>();

  for (const target of targets.blocks) {
    const comments = await listComments(target.id);
    for (const comment of comments) {
      const text = richTextPlainText(comment.rich_text);
      if (!text) continue;

      const discussionId = comment.discussion_id || comment.id;
      const discussion = discussions.get(discussionId) ?? {
        context: target.context,
        comments: [],
      };
      discussion.comments.push({
        id: comment.id,
        createdTime: comment.created_time,
        text,
      });
      discussions.set(discussionId, discussion);
    }
  }

  const discussionEntries = [...discussions.values()].filter((discussion) => discussion.comments.length > 0);
  const commentCount = discussionEntries.reduce((total, discussion) => total + discussion.comments.length, 0);
  if (commentCount === 0) {
    return {
      markdown: "",
      commentCount: 0,
      discussionCount: 0,
      truncated: targets.truncated,
    };
  }

  const lines = [
    "## Notion comments",
    "Fetched from Notion discussions. Treat as editorial context from the source page.",
    ...discussionEntries.flatMap((discussion, index) => [
      "",
      `### Comment thread ${index + 1}${discussion.context ? `: ${discussion.context}` : ""}`,
      ...discussion.comments.flatMap((comment) => [
        `Commented at ${comment.createdTime}:`,
        ...comment.text.split(/\r?\n/).map((line) => `> ${line}`),
      ]),
    ]),
  ];

  return {
    markdown: lines.join("\n"),
    commentCount,
    discussionCount: discussionEntries.length,
    truncated: targets.truncated,
  };
}

async function collectCommentTargets(pageId: string): Promise<{
  blocks: { id: string; context: string }[];
  truncated: boolean;
}> {
  const blocks: { id: string; context: string }[] = [{ id: pageId, context: "Page" }];
  const queue = [pageId];
  let truncated = false;

  while (queue.length > 0 && blocks.length < maxCommentBlocks) {
    const blockId = queue.shift()!;
    const children = await listBlockChildren(blockId);
    for (const block of children) {
      blocks.push({
        id: block.id,
        context: blockTextContext(block),
      });
      if (block.has_children && blocks.length < maxCommentBlocks) {
        queue.push(block.id);
      }
      if (blocks.length >= maxCommentBlocks) {
        truncated = true;
        break;
      }
    }
  }

  return { blocks, truncated };
}

async function listBlockChildren(blockId: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let startCursor: string | null = null;

  do {
    const params: Record<string, string> = { page_size: "100" };
    if (startCursor) params.start_cursor = startCursor;
    const payload: NotionListResponse<NotionBlock> = await notionApiJson(`blocks/${blockId}/children`, params);
    blocks.push(...payload.results);
    startCursor = payload.next_cursor ?? null;
  } while (startCursor);

  return blocks;
}

async function listComments(blockId: string): Promise<NotionComment[]> {
  const comments: NotionComment[] = [];
  let startCursor: string | null = null;

  do {
    const params: Record<string, string> = { block_id: blockId, page_size: "100" };
    if (startCursor) params.start_cursor = startCursor;
    const payload: NotionListResponse<NotionComment> = await notionApiJson("comments", params);
    comments.push(...payload.results);
    startCursor = payload.next_cursor ?? null;
  } while (startCursor);

  return comments;
}

type NotionListResponse<T> = {
  results: T[];
  next_cursor?: string | null;
};

type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
};

type NotionComment = {
  id: string;
  discussion_id?: string;
  created_time: string;
  rich_text: NotionRichText[];
};

type NotionRichText = {
  plain_text?: string;
};

function blockTextContext(block: NotionBlock): string {
  const value = block[block.type] as { rich_text?: NotionRichText[]; title?: NotionRichText[]; caption?: NotionRichText[] } | undefined;
  return truncateText(
    richTextPlainText(value?.rich_text ?? value?.title ?? value?.caption ?? []),
    120,
  );
}

function richTextPlainText(richText: NotionRichText[] = []): string {
  return richText.map((text) => text.plain_text ?? "").join("").trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

async function notionApiJson<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const response = await notionApiFetch(path, params);
  return response.json() as Promise<T>;
}

async function notionApiFetch(path: string, params: Record<string, string> = {}): Promise<Response> {
  const token = requireEnv("NOTION_API_KEY");
  const notionVersion = optionalEnv("NOTION_VERSION") ?? "2026-03-11";
  const url = new URL(`https://api.notion.com/v1/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": notionVersion,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Notion API fetch failed: ${response.status} ${body}`);
  }

  return response;
}
