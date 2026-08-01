import type { PageRecord } from "@/lib/db";
import { ensureSchema, getPool, query } from "@/lib/db";
import { isNotionUrl, parseNotionPageId, slugFromNotionUrl } from "@/lib/notion";
import { InvalidNotionUrlError, pageKeyFromPageId } from "@/lib/page-store";

export const freeSitesPerDay = 2;

export type SiteQuota = {
  unlimited: boolean;
  used: number;
  limit: number | null;
  remaining: number | null;
};

export type UserSiteResult = {
  page: PageRecord;
  siteCreated: boolean;
};

export class DailySiteLimitError extends Error {
  constructor() {
    super(`Daily site limit reached. You can create ${freeSitesPerDay} sites per UTC day.`);
    this.name = "DailySiteLimitError";
  }
}

export function isDailySiteLimitError(error: unknown): error is DailySiteLimitError {
  return error instanceof DailySiteLimitError;
}

export function hasUnlimitedSites(email: string): boolean {
  return email.trim().toLowerCase().endsWith("@iosg.vc");
}

export async function createUserSiteFromNotionUrl(input: {
  notionUrl: string;
  userId: string;
  email: string;
}): Promise<UserSiteResult> {
  const source = parseSource(input.notionUrl);
  await ensureSchema();
  const client = await getPool().connect();

  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [input.userId]);

    const existing = await client.query<PageRecord>(
      `
        select pages.*
        from user_sites
        join pages using (page_key)
        where user_sites.user_id = $1
          and pages.notion_page_id = $2
      `,
      [input.userId, source.notionPageId],
    );

    if (existing.rows[0]) {
      await client.query("commit");
      return { page: existing.rows[0], siteCreated: false };
    }

    if (!hasUnlimitedSites(input.email)) {
      const reservation = await client.query<{ used_count: number }>(
        `
          insert into daily_site_usage (user_id, usage_date, used_count, updated_at)
          values ($1, (now() at time zone 'UTC')::date, 1, now())
          on conflict (user_id, usage_date)
          do update set
            used_count = daily_site_usage.used_count + 1,
            updated_at = now()
          where daily_site_usage.used_count < $2
          returning used_count
        `,
        [input.userId, freeSitesPerDay],
      );

      if (!reservation.rows[0]) {
        throw new DailySiteLimitError();
      }
    }

    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`page-slug:${source.slug}`]);
    const slugResult = await client.query<{ slug: string }>(
      `
        select coalesce(
          (select slug from pages where notion_page_id = $2),
          case
            when exists(select 1 from pages where slug = $1) then $1 || '-' || $3
            else $1
          end
        ) as slug
      `,
      [source.slug, source.notionPageId, source.pageKey],
    );
    const availableSlug = slugResult.rows[0]?.slug ?? source.slug;

    const log = JSON.stringify({
      at: new Date().toISOString(),
      status: "queued",
      step: "Queued",
      progress: 0,
    });
    const pageResult = await client.query<PageRecord>(
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
        values ($1, $2, $3, $4, 'queued', 'Queued', 0, jsonb_build_array($5::jsonb), now(), now())
        on conflict (notion_page_id)
        do update set
          notion_url = excluded.notion_url,
          user_transformed_at = now(),
          updated_at = now()
        returning *
      `,
      [source.pageKey, availableSlug, source.notionPageId, input.notionUrl, log],
    );
    const page = pageResult.rows[0];

    await client.query(
      "insert into user_sites (user_id, page_key) values ($1, $2)",
      [input.userId, page.page_key],
    );
    await client.query("commit");
    return { page, siteCreated: true };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listUserSites(userId: string, limit = 20): Promise<PageRecord[]> {
  return query<PageRecord>(
    `
      select pages.*
      from user_sites
      join pages using (page_key)
      where user_sites.user_id = $1
      order by user_sites.created_at desc
      limit $2
    `,
    [userId, limit],
  );
}

export async function getUserSiteQuota(userId: string, email: string): Promise<SiteQuota> {
  if (hasUnlimitedSites(email)) {
    return { unlimited: true, used: 0, limit: null, remaining: null };
  }

  const rows = await query<{ used_count: number }>(
    `
      select used_count
      from daily_site_usage
      where user_id = $1
        and usage_date = (now() at time zone 'UTC')::date
    `,
    [userId],
  );
  const used = rows[0]?.used_count ?? 0;
  return {
    unlimited: false,
    used,
    limit: freeSitesPerDay,
    remaining: Math.max(0, freeSitesPerDay - used),
  };
}

export async function userOwnsSite(userId: string, pageKey: string): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    "select exists(select 1 from user_sites where user_id = $1 and page_key = $2) as exists",
    [userId, pageKey],
  );
  return rows[0]?.exists === true;
}

function parseSource(notionUrl: string) {
  if (!isNotionUrl(notionUrl)) throw new InvalidNotionUrlError();

  try {
    const notionPageId = parseNotionPageId(notionUrl);
    return {
      notionPageId,
      pageKey: pageKeyFromPageId(notionPageId),
      slug: slugFromNotionUrl(notionUrl),
    };
  } catch {
    throw new InvalidNotionUrlError();
  }
}
