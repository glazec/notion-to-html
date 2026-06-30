import type { DocumentHtmlJson } from "@/lib/document";
import type { PageRecord, PageStatus } from "@/lib/db";
import { query } from "@/lib/db";
import { parseNotionPageId, slugFromNotionUrl } from "@/lib/notion";

export function pageKeyFromPageId(pageId: string): string {
  return pageId.replaceAll("-", "").slice(0, 14);
}

export async function upsertPageFromNotionUrl(
  notionUrl: string,
  options: { userTransformed?: boolean } = {},
): Promise<PageRecord> {
  const notionPageId = parseNotionPageId(notionUrl);
  const pageKey = pageKeyFromPageId(notionPageId);
  const slug = slugFromNotionUrl(notionUrl);
  const userTransformed = options.userTransformed === true;
  const rows = await query<PageRecord>(
    `
      insert into pages (
        page_key,
        slug,
        notion_page_id,
        notion_url,
        status,
        generation_step,
        generation_progress,
        user_transformed_at,
        updated_at
      )
      values ($1, $2, $3, $4, 'queued', 'Queued', 0, case when $5 then now() else null end, now())
      on conflict (notion_page_id)
      do update set
        slug = excluded.slug,
        notion_url = excluded.notion_url,
        user_transformed_at = case when $5 then now() else pages.user_transformed_at end,
        updated_at = now()
      returning *
    `,
    [pageKey, slug, notionPageId, notionUrl, userTransformed],
  );

  return rows[0];
}

export async function findPageBySlug(slug: string): Promise<PageRecord | null> {
  const rows = await query<PageRecord>("select * from pages where slug = $1", [slug]);
  return rows[0] ?? null;
}

export async function listRecentPages(limit = 20): Promise<PageRecord[]> {
  return query<PageRecord>(
    `
      select *
      from pages
      where user_transformed_at is not null
      order by user_transformed_at desc, updated_at desc
      limit $1
    `,
    [limit],
  );
}

export async function findPage(pageKey: string): Promise<PageRecord | null> {
  const rows = await query<PageRecord>("select * from pages where page_key = $1", [pageKey]);
  return rows[0] ?? null;
}

export async function setPageStatus(
  pageKey: string,
  status: PageStatus,
  lastError: string | null = null,
): Promise<PageRecord> {
  const rows = await query<PageRecord>(
    `
      update pages
      set status = $2,
          last_error = $3,
          generation_step = case when $2 = 'failed' then coalesce($3, 'Generation failed') else generation_step end,
          generation_progress = case when $2 = 'failed' then 0 else generation_progress end,
          updated_at = now()
      where page_key = $1
      returning *
    `,
    [pageKey, status, lastError],
  );

  if (!rows[0]) {
    throw new Error(`Page not found: ${pageKey}`);
  }

  return rows[0];
}

export async function setPageGenerationProgress(input: {
  pageKey: string;
  status: PageStatus;
  step: string;
  progress: number;
}): Promise<PageRecord> {
  const rows = await query<PageRecord>(
    `
      update pages
      set status = $2,
          generation_step = $3,
          generation_progress = $4,
          updated_at = now()
      where page_key = $1
      returning *
    `,
    [input.pageKey, input.status, input.step, Math.max(0, Math.min(100, input.progress))],
  );

  if (!rows[0]) {
    throw new Error(`Page not found: ${input.pageKey}`);
  }

  return rows[0];
}

export async function markPageDirty(pageKey: string, dirtyAt: Date): Promise<PageRecord> {
  const rows = await query<PageRecord>(
    `
      update pages
      set dirty_at = $2,
          status = 'queued',
          generation_step = 'Queued for regeneration',
          generation_progress = 0,
          updated_at = now()
      where page_key = $1
      returning *
    `,
    [pageKey, dirtyAt],
  );

  if (!rows[0]) {
    throw new Error(`Page not found: ${pageKey}`);
  }

  return rows[0];
}

export async function completePageGeneration(input: {
  pageKey: string;
  contentHash: string;
  objectKey: string;
  documentJson: DocumentHtmlJson;
}): Promise<PageRecord> {
  await query(
    `
      insert into page_versions (page_key, content_hash, object_key, document_json)
      values ($1, $2, $3, $4::jsonb)
      on conflict (page_key, content_hash) do nothing
    `,
    [
      input.pageKey,
      input.contentHash,
      input.objectKey,
      JSON.stringify(input.documentJson),
    ],
  );

  const rows = await query<PageRecord>(
    `
      update pages
      set current_hash = $2,
          status = 'ready',
          dirty_at = null,
          last_generated_at = now(),
          generation_step = 'Ready',
          generation_progress = 100,
          last_error = null,
          updated_at = now()
      where page_key = $1
      returning *
    `,
    [input.pageKey, input.contentHash],
  );

  if (!rows[0]) {
    throw new Error(`Page not found: ${input.pageKey}`);
  }

  return rows[0];
}

export async function getCurrentVersion(pageKey: string): Promise<{
  object_key: string;
  document_json: DocumentHtmlJson;
  generated_at: Date;
} | null> {
  const rows = await query<{
    object_key: string;
    document_json: DocumentHtmlJson;
    generated_at: Date;
  }>(
    `
      select pv.object_key, pv.document_json, pv.generated_at
      from pages p
      join page_versions pv
        on pv.page_key = p.page_key
       and pv.content_hash = p.current_hash
      where p.page_key = $1
      limit 1
    `,
    [pageKey],
  );

  return rows[0] ?? null;
}
