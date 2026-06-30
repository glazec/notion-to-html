import { NextResponse } from "next/server";
import { events, inngest } from "@/inngest/client";
import { findPage, markPageDirty, pageKeyFromPageId } from "@/lib/page-store";
import { formatNotionId } from "@/lib/notion";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    verification_token?: string;
    entity?: { id?: string; type?: string };
    type?: string;
  };

  if (body.verification_token) {
    return NextResponse.json({ verification_token: body.verification_token });
  }

  if (body.entity?.type !== "page" || !body.entity.id) {
    return NextResponse.json({ ignored: true });
  }

  const pageId = formatNotionId(body.entity.id);
  const pageKey = pageKeyFromPageId(pageId);
  const dirtyAt = new Date();
  const page = await findPage(pageKey);

  if (!page) {
    return NextResponse.json({ ignored: true, reason: "page-not-tracked" });
  }

  await markPageDirty(pageKey, dirtyAt);
  await inngest.send({
    name: events.pageDirty,
    data: {
      pageKey,
      dirtyAt: dirtyAt.toISOString(),
      notionEventType: body.type ?? "unknown",
    },
  });

  return NextResponse.json({ ok: true });
}
