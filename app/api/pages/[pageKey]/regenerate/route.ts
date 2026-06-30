import { NextResponse } from "next/server";
import { events, inngest } from "@/inngest/client";
import { appUrl } from "@/lib/env";
import { findPage, markPageDirty } from "@/lib/page-store";
import { checkRateLimit, rateLimitKeyFromRequest } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ pageKey: string }> },
) {
  const { pageKey } = await context.params;
  const page = await findPage(pageKey);

  if (!page) {
    return NextResponse.json({ error: "Page not found" }, { status: 404 });
  }

  const pageAllowed = checkRateLimit({
    key: `page:${pageKey}:regenerate`,
    limit: 1,
    windowMs: 2 * 60 * 1000,
  });
  const ipAllowed = checkRateLimit({
    key: rateLimitKeyFromRequest(request, "regenerate"),
    limit: 20,
    windowMs: 60 * 60 * 1000,
  });

  if (!pageAllowed || !ipAllowed) {
    return NextResponse.json({ error: "Regeneration rate limit exceeded" }, { status: 429 });
  }

  const dirtyAt = new Date();
  await markPageDirty(pageKey, dirtyAt);
  await inngest.send({
    name: events.generatePage,
    data: {
      pageKey,
      requestedAt: dirtyAt.toISOString(),
      reason: "manual-regenerate",
    },
  });

  return NextResponse.redirect(new URL(`/p/${pageKey}`, appUrl()), {
    status: 303,
  });
}
