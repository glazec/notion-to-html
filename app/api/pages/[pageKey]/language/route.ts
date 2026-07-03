import { NextResponse } from "next/server";
import { events, inngest } from "@/inngest/client";
import { appUrl } from "@/lib/env";
import { findPage, isPageLanguage, setPagePreferredLanguage } from "@/lib/page-store";
import { checkRateLimitGroup, rateLimitKeyFromRequest } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ pageKey: string }> },
) {
  const form = await request.formData();
  const language = form.get("language");

  if (!isPageLanguage(language)) {
    return NextResponse.json({ error: "Unsupported language" }, { status: 400 });
  }

  const { pageKey } = await context.params;
  const page = await findPage(pageKey);

  if (!page) {
    return NextResponse.json({ error: "Page not found" }, { status: 404 });
  }

  if (page.preferred_language === language) {
    return NextResponse.redirect(new URL(`/p/${pageKey}`, appUrl()), {
      status: 303,
    });
  }

  const allowed = checkRateLimitGroup([
    {
      key: rateLimitKeyFromRequest(request, "language"),
      limit: 20,
      windowMs: 60 * 60 * 1000,
    },
    {
      key: `page:${pageKey}:language`,
      limit: 1,
      windowMs: 2 * 60 * 1000,
    },
  ]);

  if (!allowed) {
    return NextResponse.json({ error: "Language update rate limit exceeded" }, { status: 429 });
  }

  const dirtyAt = new Date();
  await setPagePreferredLanguage(pageKey, language, dirtyAt);
  await inngest.send({
    name: events.generatePage,
    data: {
      pageKey,
      requestedAt: dirtyAt.toISOString(),
      reason: "language-update",
      targetLanguage: language,
    },
  });

  return NextResponse.redirect(new URL(`/p/${pageKey}`, appUrl()), {
    status: 303,
  });
}
