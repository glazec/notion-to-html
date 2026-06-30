import { getHtmlObject, putHtmlObject } from "@/lib/bucket";
import {
  completePageGeneration,
  findPage,
  setPageGenerationProgress,
  setPageStatus,
} from "@/lib/page-store";
import { generateDocumentJson } from "@/lib/codex-generator";
import { fetchPublicNotionContent } from "@/lib/firecrawl";
import { renderHtmlBody, wrapServedHtml } from "@/lib/render-html";
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
      step: "Building document JSON",
      progress: 55,
    });
    const documentJson = await generateDocumentJson({
      markdown: source.markdown,
      notionUrl: source.url,
    });
    await setPageGenerationProgress({
      pageKey,
      status: "generating",
      step: "Rendering HTML",
      progress: 75,
    });
    const body = renderHtmlBody(documentJson);
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

export async function buildServedHtml(input: {
  pageKey: string;
  title: string;
  notionUrl: string;
  objectKey: string;
  generatedAt?: Date | null;
  status?: "queued" | "generating" | "ready" | "failed";
  generationStep?: string | null;
  generationProgress?: number | null;
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
      generatedAt: input.generatedAt,
    },
  });
}
