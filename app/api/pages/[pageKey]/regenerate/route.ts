import { NextResponse } from "next/server";
import { events, inngest } from "@/inngest/client";
import { appUrl } from "@/lib/env";
import { findPage, markPageDirty } from "@/lib/page-store";
import { checkRateLimitGroup, rateLimitKeyFromRequest } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/auth/server";
import { userOwnsSite } from "@/lib/site-credits";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ pageKey: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to regenerate this site" }, { status: 401 });
  }

  const { pageKey } = await context.params;
  const page = await findPage(pageKey);

  if (!page) {
    return NextResponse.json({ error: "Page not found" }, { status: 404 });
  }

  if (!await userOwnsSite(user.id, pageKey)) {
    return NextResponse.json({ error: "You do not own this site" }, { status: 403 });
  }

  const allowed = checkRateLimitGroup([
    {
      key: rateLimitKeyFromRequest(request, "regenerate"),
      limit: 20,
      windowMs: 60 * 60 * 1000,
    },
    {
      key: `page:${pageKey}:regenerate`,
      limit: 1,
      windowMs: 2 * 60 * 1000,
    },
  ]);

  if (!allowed) {
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
