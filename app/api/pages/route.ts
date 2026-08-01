import { NextResponse } from "next/server";
import { appUrl } from "@/lib/env";
import { isInvalidNotionUrlError } from "@/lib/page-store";
import { inngest, events } from "@/inngest/client";
import { isMissingEnvError, missingConfigResponse } from "@/lib/http-errors";
import { checkInitialGenerationRateLimit } from "@/lib/initial-generation-rate-limit";
import { getCurrentUser } from "@/lib/auth/server";
import { createUserSiteFromNotionUrl, isDailySiteLimitError } from "@/lib/site-credits";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const notionUrl = new URL(request.url).searchParams.get("notionUrl")?.trim() ?? "";

  if (!notionUrl) {
    return NextResponse.json({ error: "notionUrl is required" }, { status: 400 });
  }

  return createPageRedirect(request, notionUrl);
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const notionUrl = String(formData.get("notionUrl") ?? "").trim();

  if (!notionUrl) {
    return NextResponse.json({ error: "notionUrl is required" }, { status: 400 });
  }

  return createPageRedirect(request, notionUrl);
}

async function createPageRedirect(request: Request, notionUrl: string) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in with Google to create a site" }, { status: 401 });
  }

  if (!checkInitialGenerationRateLimit(request)) {
    return NextResponse.json({ error: "Initial generation rate limit exceeded" }, { status: 429 });
  }

  let page;

  try {
    const result = await createUserSiteFromNotionUrl({
      notionUrl,
      userId: user.id,
      email: user.email,
    });
    page = result.page;
  } catch (error) {
    if (isInvalidNotionUrlError(error)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (isMissingEnvError(error)) {
      return missingConfigResponse(error);
    }
    if (isDailySiteLimitError(error)) {
      return NextResponse.json({ error: error.message }, { status: 429 });
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
