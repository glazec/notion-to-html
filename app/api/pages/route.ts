import { NextResponse } from "next/server";
import { appUrl } from "@/lib/env";
import { upsertPageFromNotionUrl } from "@/lib/page-store";
import { inngest, events } from "@/inngest/client";
import { isMissingEnvError, missingConfigResponse } from "@/lib/http-errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const notionUrl = new URL(request.url).searchParams.get("notionUrl")?.trim() ?? "";

  if (!notionUrl) {
    return NextResponse.json({ error: "notionUrl is required" }, { status: 400 });
  }

  return createPageRedirect(notionUrl, false);
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const notionUrl = String(formData.get("notionUrl") ?? "").trim();

  if (!notionUrl) {
    return NextResponse.json({ error: "notionUrl is required" }, { status: 400 });
  }

  return createPageRedirect(notionUrl, true);
}

async function createPageRedirect(notionUrl: string, userTransformed: boolean) {
  let page;

  try {
    page = await upsertPageFromNotionUrl(notionUrl, { userTransformed });
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
    },
  });

  return NextResponse.redirect(new URL(`/${page.slug}`, appUrl()), {
    status: 303,
  });
}
