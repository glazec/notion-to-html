import { getHtmlObject, putHtmlObject } from "@/lib/bucket";
import {
  completePageGeneration,
  findPage,
  setPageGenerationProgress,
  setPageStatus,
} from "@/lib/page-store";
import { generateDocumentHtmlBody } from "@/lib/codex-generator";
import { fetchPublicNotionContent } from "@/lib/firecrawl";
import { documentFromMarkdown } from "@/lib/document";
import type { GenerationLogEntry } from "@/lib/db";
import { wrapServedHtml } from "@/lib/render-html";
import { sha256 } from "@/lib/hash";

export async function generatePage(pageKey: string): Promise<{
  pageKey: string;
  contentHash: string;
  objectKey: string;
}> {
  const page = await findPage(pageKey);
  if (!page) {
    throw new Error(`Page not found: ${pageKey}`);
  }

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
      step: "Crawling public Notion page",
      progress: 25,
    });
    const source = await fetchPublicNotionContent(page.notion_url);
    await setPageGenerationProgress({
      pageKey,
      status: "generating",
      step: "Generating document-to-html page",
      progress: 55,
    });
    const documentJson = documentFromMarkdown({
      markdown: source.markdown,
      notionUrl: source.url,
    });
    await setPageGenerationProgress({
      pageKey,
      status: "generating",
      step: "Rendering HTML",
      progress: 75,
    });
    const body = await withCodexHeartbeat(pageKey, () => generateDocumentHtmlBody({
      markdown: source.markdown,
      notionUrl: source.url,
    }));
    const contentHash = sha256(body);
    const objectKey = `pages/${source.pageId}/${contentHash}/index.html`;

    await setPageGenerationProgress({
      pageKey,
      status: "generating",
      step: "Publishing cached HTML",
      progress: 90,
    });
    await putHtmlObject(objectKey, body);
    await completePageGeneration({
      pageKey,
      contentHash,
      objectKey,
      documentJson,
    });

    return { pageKey, contentHash, objectKey };
  } catch (error) {
    await setPageStatus(pageKey, "failed", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function withCodexHeartbeat<T>(
  pageKey: string,
  work: () => Promise<T>,
): Promise<T> {
  let minutes = 0;
  const timer = setInterval(() => {
    minutes += 1;
    void setPageGenerationProgress({
      pageKey,
      status: "generating",
      step: `Codex generation still running (${minutes}m)`,
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
}): Promise<string> {
  const body = await getHtmlObject(input.objectKey);
  return wrapServedHtml({
    title: input.title,
    body,
    notionUrl: input.notionUrl,
    regeneratePath: `/api/pages/${input.pageKey}/regenerate`,
    pageState: {
      status: input.status,
      generationStep: input.generationStep,
      generationProgress: input.generationProgress,
      generationLog: input.generationLog,
      generatedAt: input.generatedAt,
    },
  });
}
