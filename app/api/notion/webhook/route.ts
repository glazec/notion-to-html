import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { events, inngest } from "@/inngest/client";
import { optionalEnv } from "@/lib/env";
import { findPage, markPageDirty, pageKeyFromPageId } from "@/lib/page-store";
import { formatNotionId } from "@/lib/notion";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const body = JSON.parse(rawBody) as {
    verification_token?: string;
    entity?: { id?: string; type?: string };
    type?: string;
  };

  if (body.verification_token) {
    return NextResponse.json({ verification_token: body.verification_token });
  }

  const verificationError = verifyNotionWebhookRequest(request, rawBody);
  if (verificationError) return verificationError;

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

function verifyNotionWebhookRequest(request: Request, rawBody: string): Response | null {
  const verificationToken = optionalEnv("NOTION_WEBHOOK_VERIFICATION_TOKEN") ?? optionalEnv("NOTION_WEBHOOK_SECRET");
  if (!verificationToken) {
    return NextResponse.json({ error: "Notion webhook verification token is not configured" }, { status: 503 });
  }

  const signature = request.headers.get("x-notion-signature");
  if (!signature?.startsWith("sha256=")) {
    return NextResponse.json({ error: "Invalid Notion webhook signature" }, { status: 401 });
  }

  const expectedSignature = `sha256=${createHmac("sha256", verificationToken)
    .update(rawBody)
    .digest("hex")}`;

  if (
    signature.length !== expectedSignature.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  ) {
    return NextResponse.json({ error: "Invalid Notion webhook signature" }, { status: 401 });
  }

  return null;
}
