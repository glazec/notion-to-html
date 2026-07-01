import { generatePage } from "@/lib/generation";
import { findPage } from "@/lib/page-store";
import { notionEditIdleSleep } from "@/lib/regeneration-policy";
import { inngest, events } from "@/inngest/client";

export const generatePageFunction = inngest.createFunction(
  {
    id: "generate-page",
    retries: 2,
    concurrency: {
      limit: 1,
      key: "event.data.pageKey",
    },
  },
  { event: events.generatePage },
  async ({ event, step }) => {
    const pageKey = String(event.data.pageKey);
    return step.run("generate-page-html", async () => generatePage(pageKey));
  },
);

export const regenerateWhenIdleFunction = inngest.createFunction(
  {
    id: "regenerate-page-when-idle",
    retries: 2,
    concurrency: {
      limit: 1,
      key: "event.data.pageKey",
    },
  },
  { event: events.pageDirty },
  async ({ event, step }) => {
    const pageKey = String(event.data.pageKey);
    const dirtyAt = String(event.data.dirtyAt);

    await step.sleep("wait-for-edit-idle", notionEditIdleSleep);

    const shouldRegenerate = await step.run("check-stale-edit", async () => {
      const page = await findPage(pageKey);
      return page?.dirty_at?.toISOString() === dirtyAt;
    });

    if (!shouldRegenerate) {
      return { skipped: true, reason: "newer-edit-exists" };
    }

    return step.run("regenerate-page-html", async () => generatePage(pageKey));
  },
);

export const functions = [generatePageFunction, regenerateWhenIdleFunction];
