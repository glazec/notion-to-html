import type { DocumentHtmlJson } from "@/lib/document";
import type { GenerationLogEntry, PageLanguage, PageRecord, PageStatus } from "@/lib/db";
import { query } from "@/lib/db";
import { isNotionUrl, parseNotionPageId, slugFromNotionUrl } from "@/lib/notion";

const maxGenerationLogEntries = 40;
const redactedText = "[redacted]";
const redactedUrl = "[url redacted]";

export function pageKeyFromPageId(pageId: string): string {
  return pageId.replaceAll("-", "").slice(0, 14);
}

export class InvalidNotionUrlError extends Error {
  constructor(message = "A valid Notion page URL is required.") {
    super(message);
    this.name = "InvalidNotionUrlError";
  }
}

export function isPageLanguage(value: unknown): value is PageLanguage {
  return value === "auto" || value === "en" || value === "zh-CN" || value === "ja";
}

export function isInvalidNotionUrlError(error: unknown): error is InvalidNotionUrlError {
  return error instanceof InvalidNotionUrlError;
}

export async function upsertPageFromNotionUrl(
  notionUrl: string,
  options: { userTransformed?: boolean } = {},
): Promise<PageRecord> {
  if (!isNotionUrl(notionUrl)) {
    throw new InvalidNotionUrlError();
  }

  let notionPageId: string;
  try {
    notionPageId = parseNotionPageId(notionUrl);
  } catch {
    throw new InvalidNotionUrlError();
  }

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
        generation_log,
        user_transformed_at,
        updated_at
      )
      values ($1, $2, $3, $4, 'queued', 'Queued', 0, jsonb_build_array($6::jsonb), case when $5 then now() else null end, now())
      on conflict (notion_page_id)
      do update set
        slug = excluded.slug,
        notion_url = excluded.notion_url,
        user_transformed_at = case when $5 then now() else pages.user_transformed_at end,
        updated_at = now()
      returning *
    `,
    [
      pageKey,
      slug,
      notionPageId,
      notionUrl,
      userTransformed,
      JSON.stringify(generationLogEntry("queued", "Queued", 0)),
    ],
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
  const safeLastError = lastError ? sanitizePublicLogText(lastError) : null;
  const rows = await query<PageRecord>(
    `
      update pages
      set status = $2,
          last_error = $3,
          generation_step = case when $2 = 'failed' then coalesce($3, 'Generation failed') else generation_step end,
          generation_progress = case when $2 = 'failed' then 0 else generation_progress end,
          generation_log = case
            when $2 = 'failed' then ${appendGenerationLogSql("$4::jsonb")}
            else generation_log
          end,
          updated_at = now()
      where page_key = $1
      returning *
    `,
    [
      pageKey,
      status,
      safeLastError,
      JSON.stringify(generationLogEntry(status, safeLastError || "Generation failed", 0)),
    ],
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
  const safeStep = sanitizePublicLogText(input.step);
  const rows = await query<PageRecord>(
    `
      update pages
      set status = $2,
          generation_step = $3,
          generation_progress = $4,
          generation_log = ${appendGenerationLogSql("$5::jsonb")},
          updated_at = now()
      where page_key = $1
      returning *
    `,
    [
      input.pageKey,
      input.status,
      safeStep,
      Math.max(0, Math.min(100, input.progress)),
      JSON.stringify(generationLogEntry(input.status, safeStep, input.progress)),
    ],
  );

  if (!rows[0]) {
    throw new Error(`Page not found: ${input.pageKey}`);
  }

  return rows[0];
}

function sanitizePublicLogText(value: string): string {
  return value
    .replace(/\b(?:postgres|postgresql|mysql|redis|mongodb(?:\+srv)?):\/\/[^\s)'"<>]+/gi, redactedUrl)
    .replace(/\bhttps?:\/\/[^\s)'"<>]+/gi, redactedUrl)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${redactedText}`)
    .replace(/\b(?:token|api[_-]?key|access[_-]?key|secret|password)\s*[:=]\s*[^\s,;'"<>]+/gi, (_match, name: string) => `${name}: ${redactedText}`)
    .replace(/\b(?:sk|fc|ntn|r2yr|signkey-prod)_[A-Za-z0-9._~+/=-]{8,}\b/g, redactedText)
    .replace(/\b(?:sk|fc)-[A-Za-z0-9._~+/=-]{8,}\b/g, redactedText)
    .replace(/\bsignkey-prod-[A-Za-z0-9._~+/=-]{8,}\b/g, redactedText)
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, redactedText);
}

export async function markPageDirty(pageKey: string, dirtyAt: Date): Promise<PageRecord> {
  const rows = await query<PageRecord>(
    `
      update pages
      set dirty_at = $2,
          status = 'queued',
          generation_step = 'Queued for regeneration',
          generation_progress = 0,
          generation_log = jsonb_build_array($3::jsonb),
          updated_at = now()
      where page_key = $1
      returning *
    `,
    [
      pageKey,
      dirtyAt,
      JSON.stringify(generationLogEntry("queued", "Queued for regeneration", 0, dirtyAt)),
    ],
  );

  if (!rows[0]) {
    throw new Error(`Page not found: ${pageKey}`);
  }

  return rows[0];
}

export async function setPagePreferredLanguage(
  pageKey: string,
  language: PageLanguage,
  dirtyAt: Date,
): Promise<PageRecord> {
  const rows = await query<PageRecord>(
    `
      update pages
      set preferred_language = $2,
          dirty_at = $3,
          status = 'queued',
          generation_step = 'Queued for language update',
          generation_progress = 0,
          generation_log = jsonb_build_array($4::jsonb),
          updated_at = now()
      where page_key = $1
      returning *
    `,
    [
      pageKey,
      language,
      dirtyAt,
      JSON.stringify(generationLogEntry("queued", "Queued for language update", 0, dirtyAt)),
    ],
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
  generationStartedAt: Date;
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
          status = case
            when dirty_at is not null and dirty_at > $4 then 'queued'
            else 'ready'
          end,
          dirty_at = case
            when dirty_at is not null and dirty_at > $4 then dirty_at
            else null
          end,
          last_generated_at = now(),
          generation_step = case
            when dirty_at is not null and dirty_at > $4 then 'Queued for regeneration'
            else 'Ready'
          end,
          generation_progress = case
            when dirty_at is not null and dirty_at > $4 then 0
            else 100
          end,
          generation_log = ${appendGenerationLogSql("$3::jsonb")},
          last_error = null,
          updated_at = now()
      where page_key = $1
      returning *
    `,
    [
      input.pageKey,
      input.contentHash,
      JSON.stringify(generationLogEntry("ready", "Published cached HTML", 100)),
      input.generationStartedAt,
    ],
  );

  if (!rows[0]) {
    throw new Error(`Page not found: ${input.pageKey}`);
  }

  return rows[0];
}

function generationLogEntry(
  status: PageStatus,
  step: string,
  progress: number,
  at = new Date(),
): GenerationLogEntry {
  return {
    at: at.toISOString(),
    status,
    step,
    progress: Math.max(0, Math.min(100, Math.round(progress))),
  };
}

function appendGenerationLogSql(entrySql: string): string {
  return `(
    select coalesce(jsonb_agg(entry order by ord), '[]'::jsonb)
    from (
      select entry, ord
      from jsonb_array_elements(coalesce(generation_log, '[]'::jsonb) || jsonb_build_array(${entrySql})) with ordinality as items(entry, ord)
      order by ord desc
      limit ${maxGenerationLogEntries}
    ) recent
  )`;
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
