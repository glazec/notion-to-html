import { getHtmlObject, putHtmlObject } from "@/lib/bucket";
import {
  completePageGeneration,
  findPage,
  setPageGenerationProgress,
  setPageStatus,
} from "@/lib/page-store";
import { generateDocumentHtmlBody } from "@/lib/codex-generator";
import { fetchSourceContent } from "@/lib/content-source";
import { documentFromMarkdown } from "@/lib/document";
import type { GenerationLogEntry, PageLanguage } from "@/lib/db";
import type { PublicNotionDatabase } from "@/lib/notion-database";
import { fetchPublicNotionDatabase } from "@/lib/notion-database";
import { renderNotionDatabaseHtmlBody } from "@/lib/notion-database-html";
import { prepareSourceAssets } from "@/lib/source-assets";
import { wrapServedHtml } from "@/lib/render-html";
import { sha256 } from "@/lib/hash";
import { isNotionUrl } from "@/lib/notion";

export async function generatePage(pageKey: string): Promise<{
  pageKey: string;
  contentHash: string;
  objectKey: string;
} | {
  pageKey: string;
  skipped: true;
  reason: "already-ready";
}> {
  const page = await findPage(pageKey);
  if (!page) {
    throw new Error(`Page not found: ${pageKey}`);
  }

  if (page.status === "ready" && page.current_hash && !page.dirty_at) {
    return { pageKey, skipped: true, reason: "already-ready" };
  }

  const generationStartedAt = new Date();

  await setPageGenerationProgress({
    pageKey,
    status: "generating",
    step: "Starting generation",
    progress: 10,
  });

  try {
    await setPageGenerationProgress({
      pageKey,
      status: "generating",
      step: "Fetching public Notion collection rows",
      progress: 25,
    });
    const database = await fetchPublicNotionDatabase(page.notion_url).catch(() => null);
    if (database && database.rows.length > 0) {
      return publishDatabasePage({
        pageKey,
        database,
        generationStartedAt,
      });
    }

    await setPageGenerationProgress({
      pageKey,
      status: "generating",
      step: "Fetching Notion content source",
      progress: 25,
    });
    const source = await fetchSourceContent(page.notion_url);
    await setPageGenerationProgress({
      pageKey,
      status: "generating",
      step: `${source.sourceName} returned ${source.markdown.length} markdown chars`,
      progress: 35,
    });
    if (source.warning) {
      await setPageGenerationProgress({
        pageKey,
        status: "generating",
        step: source.warning,
        progress: 38,
      });
    }
    const sourceStats = analyzeSourceMarkdown(source.markdown);
    await setPageGenerationProgress({
      pageKey,
      status: "generating",
      step: `Preparing source assets: ${plural(sourceStats.imageCount, "image")}, ${plural(sourceStats.notionLinkCount, "Notion link")}`,
      progress: 50,
    });
    const preparedSource = await prepareSourceAssets({
      pageId: source.pageId,
      markdown: source.markdown,
    });
    const skippedImages = preparedSource.skippedImages ?? [];
    const skippedImageText = skippedImages.length === 0
      ? ""
      : `; skipped ${plural(skippedImages.length, "image")}`;
    await setPageGenerationProgress({
      pageKey,
      status: "generating",
      step: preparedSource.images.length === 0
        ? skippedImages.length === 0
          ? "No source images to store"
          : `Skipped ${plural(skippedImages.length, "image")}; no source images to store`
        : `Stored and described ${plural(preparedSource.images.length, "image")}${skippedImageText}`,
      progress: 58,
    });
    await setPageGenerationProgress({
      pageKey,
      status: "generating",
      step: sourceStats.notionLinkCount === 0
        ? "No linked Notion pages found"
        : `Preserving ${plural(sourceStats.notionLinkCount, "linked Notion page")}`,
      progress: 62,
    });
    await setPageGenerationProgress({
      pageKey,
      status: "generating",
      step: source.commentCount === 0
        ? "No Notion comments found"
        : `Included ${plural(source.commentCount, "Notion comment")} from ${plural(source.discussionCount, "discussion")}`,
      progress: 66,
    });
    const documentJson = documentFromMarkdown({
      markdown: preparedSource.markdown,
      notionUrl: source.url,
    });
    const body = await generateCodexBody({
        pageKey,
        markdown: preparedSource.markdown,
        notionUrl: source.url,
        targetLanguage: page.preferred_language ?? "auto",
        imageCount: preparedSource.images.length,
        notionLinkCount: sourceStats.notionLinkCount,
        commentCount: source.commentCount,
      });
    await setPageGenerationProgress({
      pageKey,
      status: "generating",
      step: "Finished Codex document-to-html generation",
      progress: 88,
    });
    const contentHash = sha256(body);
    const objectKey = `pages/${source.pageId}/${contentHash}/index.html`;

    await setPageGenerationProgress({
      pageKey,
      status: "generating",
      step: "Publishing cached HTML object",
      progress: 90,
    });
    await putHtmlObject(objectKey, body);
    await completePageGeneration({
      pageKey,
      contentHash,
      objectKey,
      documentJson,
      generationStartedAt,
    });

    return { pageKey, contentHash, objectKey };
  } catch (error) {
    await setPageStatus(pageKey, "failed", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function publishDatabasePage(input: {
  pageKey: string;
  database: PublicNotionDatabase;
  generationStartedAt: Date;
}): Promise<{
  pageKey: string;
  contentHash: string;
  objectKey: string;
}> {
  const database = input.database;
  await setPageGenerationProgress({
    pageKey: input.pageKey,
    status: "generating",
    step: database.truncated
      ? `Fetched ${plural(database.rows.length, "Notion database row")}; collection reported more rows`
      : `Fetched ${plural(database.rows.length, "Notion database row")}`,
    progress: 42,
  });
  await setPageGenerationProgress({
    pageKey: input.pageKey,
    status: "generating",
    step: `Rendering deterministic Notion database HTML: ${plural(database.rows.length, "row")}`,
    progress: 88,
  });

  const body = renderNotionDatabaseHtmlBody(database);
  const documentJson = documentFromMarkdown({
    markdown: databaseMarkdown(database),
    notionUrl: database.sourceUrl,
  });
  const contentHash = sha256(body);
  const objectKey = `pages/${database.pageId}/${contentHash}/index.html`;

  await setPageGenerationProgress({
    pageKey: input.pageKey,
    status: "generating",
    step: "Publishing cached HTML object",
    progress: 90,
  });
  await putHtmlObject(objectKey, body);
  await completePageGeneration({
    pageKey: input.pageKey,
    contentHash,
    objectKey,
    documentJson,
    generationStartedAt: input.generationStartedAt,
  });

  return { pageKey: input.pageKey, contentHash, objectKey };
}

function databaseMarkdown(database: PublicNotionDatabase): string {
  const lines = [
    `# ${database.title}`,
    "",
    `Source: ${database.sourceUrl}`,
    `Rows fetched: ${database.rows.length}${database.truncated ? " plus more reported by Notion" : ""}`,
    "",
    "## Rows",
    ...database.rows.map((row, index) => {
      const parts = [
        `${index + 1}. [${row.title}](${row.rowUrl})`,
        row.category ? `Category: ${row.category}` : "",
        row.productUrl ? `URL: ${row.productUrl}` : "",
        row.description ? `Description: ${row.description}` : "",
      ].filter(Boolean);
      return parts.join(" | ");
    }),
  ];

  return lines.join("\n");
}

function analyzeSourceMarkdown(markdown: string): {
  imageCount: number;
  notionLinkCount: number;
} {
  const imageUrls = new Set<string>();
  const notionLinks = new Set<string>();

  for (const match of markdown.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) {
    imageUrls.add(match[1]);
  }

  for (const match of markdown.matchAll(/https?:\/\/[^\s)\]]+/g)) {
    const url = trimUrlPunctuation(match[0]);
    if (isNotionUrl(url)) {
      notionLinks.add(url);
    }
  }

  return {
    imageCount: imageUrls.size,
    notionLinkCount: notionLinks.size,
  };
}

function trimUrlPunctuation(value: string): string {
  return value.replace(/[.,;:!?]+$/g, "");
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

async function generateCodexBody(input: {
  pageKey: string;
  markdown: string;
  notionUrl: string;
  targetLanguage: PageLanguage;
  imageCount: number;
  notionLinkCount: number;
  commentCount: number;
}): Promise<string> {
  await setPageGenerationProgress({
    pageKey: input.pageKey,
    status: "generating",
    step: `Starting Codex document-to-html generation: ${plural(input.imageCount, "image")}, ${plural(input.notionLinkCount, "Notion link")}`,
    progress: 70,
  });

  return withCodexHeartbeat(
    input.pageKey,
    {
      markdownChars: input.markdown.length,
      imageCount: input.imageCount,
      notionLinkCount: input.notionLinkCount,
      commentCount: input.commentCount,
    },
    () => generateDocumentHtmlBody({
      markdown: input.markdown,
      notionUrl: input.notionUrl,
      targetLanguage: input.targetLanguage,
    }),
  );
}

async function withCodexHeartbeat<T>(
  pageKey: string,
  context: {
    markdownChars: number;
    imageCount: number;
    notionLinkCount: number;
    commentCount: number;
  },
  work: () => Promise<T>,
): Promise<T> {
  let minutes = 0;
  const timer = setInterval(() => {
    minutes += 1;
    void setPageGenerationProgress({
      pageKey,
      status: "generating",
      step: `Codex still running: ${context.markdownChars} chars, ${plural(context.imageCount, "image")}, ${plural(context.notionLinkCount, "Notion link")}, ${plural(context.commentCount, "comment")} (${minutes}m)`,
      progress: Math.min(88, 75 + minutes),
    });
  }, 60 * 1000);

  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

export async function buildServedHtml(input: {
  pageKey: string;
  title: string;
  notionUrl: string;
  objectKey: string;
  generatedAt?: Date | null;
  status?: "queued" | "generating" | "ready" | "failed";
  generationStep?: string | null;
  generationProgress?: number | null;
  generationLog?: GenerationLogEntry[] | null;
  preferredLanguage?: PageLanguage;
}): Promise<string> {
  const body = await getHtmlObject(input.objectKey);
  return wrapServedHtml({
    title: input.title,
    body,
    notionUrl: input.notionUrl,
    regeneratePath: `/api/pages/${input.pageKey}/regenerate`,
    languagePath: `/api/pages/${input.pageKey}/language`,
    preferredLanguage: input.preferredLanguage ?? "auto",
    pageState: {
      status: input.status,
      generationStep: input.generationStep,
      generationProgress: input.generationProgress,
      generationLog: input.generationLog,
      generatedAt: input.generatedAt,
    },
  });
}
