import { NextResponse } from "next/server";
import { events, inngest } from "@/inngest/client";
import { appUrl } from "@/lib/env";
import { isMissingEnvError, missingConfigResponse } from "@/lib/http-errors";
import { notionUrlFromPathSegments } from "@/lib/notion";
import { findPageBySlug, upsertPageFromNotionUrl } from "@/lib/page-store";
import { servedPageResponse } from "@/lib/page-response";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ pagePath: string[] }> },
) {
  const { pagePath } = await context.params;
  const notionUrl = notionUrlFromPathSegments(pagePath);

  if (notionUrl) {
    return pastedNotionUrlRedirect(notionUrl);
  }

  const pageSlug = decodeURIComponent(pagePath.join("/"));
  let page;

  try {
    page = await findPageBySlug(pageSlug);
  } catch (error) {
    if (isMissingEnvError(error)) {
      return missingConfigResponse(error);
    }
    throw error;
  }

  if (!page) {
    return new Response("Page not found", { status: 404 });
  }

  return servedPageResponse(page, request.url);
}

async function pastedNotionUrlRedirect(notionUrl: string): Promise<Response> {
  let page;

  try {
    page = await upsertPageFromNotionUrl(notionUrl, { userTransformed: false });
  } catch (error) {
    if (isMissingEnvError(error)) {
      return missingConfigResponse(error);
    }
    throw error;
  }

  await inngest.send({
    name: events.generatePage,
    data: {
      pageKey: page.page_key,
      requestedAt: new Date().toISOString(),
      source: "pasted-url-path",
    },
  });

  return NextResponse.redirect(new URL(`/${page.slug}`, appUrl()), {
    status: 303,
  });
}
