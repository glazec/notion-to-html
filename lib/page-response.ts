import { events, inngest } from "@/inngest/client";
import type { PageRecord } from "@/lib/db";
import { buildServedHtml } from "@/lib/generation";
import { getCurrentVersion, setPageGenerationProgress } from "@/lib/page-store";
import { progressBodyHtml, wrapServedHtml } from "@/lib/render-html";

const queuedRecoveryMs = 60 * 1000;
const generatingRecoveryMs = 15 * 60 * 1000;

export async function servedPageResponse(page: PageRecord, requestUrl: string): Promise<Response> {
  const version = await getCurrentVersion(page.page_key);
  let displayPage = page;

  if (shouldStartGeneration(page)) {
    displayPage = await enqueueGeneration(page, requestUrl);
  }

  if (version) {
    const html = await buildServedHtml({
      pageKey: page.page_key,
      title: version.document_json.title,
      notionUrl: page.notion_url,
      objectKey: version.object_key,
      generatedAt: version.generated_at,
      status: displayPage.status,
      generationStep: displayPage.generation_step,
      generationProgress: displayPage.generation_progress,
    });

    return htmlResponse(html);
  }

  return htmlResponse(
    wrapServedHtml({
      title: page.status === "failed" ? "Generation failed" : "Generation in flight",
      notionUrl: page.notion_url,
      regeneratePath: `/api/pages/${page.page_key}/regenerate`,
      body: progressBodyHtml({
        status: displayPage.status,
        generationStep: displayPage.generation_step,
        generationProgress: displayPage.generation_progress,
        generatedAt: displayPage.last_generated_at,
      }),
      pageState: {
        status: displayPage.status,
        generationStep: displayPage.generation_step,
        generationProgress: displayPage.generation_progress,
        generatedAt: displayPage.last_generated_at,
      },
    }),
    202,
  );
}

function shouldStartGeneration(page: PageRecord): boolean {
  if (page.status === "queued") {
    if (page.current_hash || page.dirty_at) return false;
    return Date.now() - page.updated_at.getTime() > queuedRecoveryMs;
  }

  if (page.status !== "generating") return false;

  return Date.now() - page.updated_at.getTime() > generatingRecoveryMs;
}

async function enqueueGeneration(page: PageRecord, requestUrl: string): Promise<PageRecord> {
  try {
    await inngest.send({
      name: events.generatePage,
      data: {
        pageKey: page.page_key,
        requestedAt: new Date().toISOString(),
        source: requestUrl,
      },
    });
    return await setPageGenerationProgress({
      pageKey: page.page_key,
      status: "generating",
      step: "Waiting for generator",
      progress: Math.max(page.generation_progress, 5),
    });
  } catch (error) {
    console.error("Failed to enqueue generation event", error);
    return page;
  }
}

export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": status === 200
        ? "public, max-age=300, stale-while-revalidate=86400"
        : "no-store",
    },
  });
}
