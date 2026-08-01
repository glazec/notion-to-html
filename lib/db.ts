import pg from "pg";
import { requireEnv } from "@/lib/env";

const { Pool } = pg;

let pool: pg.Pool | undefined;
let schemaReady: Promise<void> | undefined;
const schemaLockSql = "select pg_advisory_xact_lock(836491, 20260630)";

export type PageStatus = "queued" | "generating" | "ready" | "failed";
export type PageLanguage = "auto" | "en" | "zh-CN" | "ja";

export type GenerationLogEntry = {
  at: string;
  status: PageStatus;
  step: string;
  progress: number;
};

export type PageRecord = {
  page_key: string;
  slug: string;
  notion_page_id: string;
  notion_url: string;
  current_hash: string | null;
  status: PageStatus;
  dirty_at: Date | null;
  last_generated_at: Date | null;
  generation_step: string | null;
  generation_progress: number;
  generation_log: GenerationLogEntry[];
  user_transformed_at: Date | null;
  preferred_language: PageLanguage;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
};

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: requireEnv("DATABASE_URL"),
      ssl: shouldUseSsl(),
    });
  }

  return pool;
}

function shouldUseSsl(): false | { rejectUnauthorized: false } {
  const databaseUrl = requireEnv("DATABASE_URL");
  if (process.env.PGSSLMODE === "disable") return false;
  if (databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1")) {
    return false;
  }
  return { rejectUnauthorized: false };
}

export async function ensureSchema(): Promise<void> {
  schemaReady ??= migrateSchema().catch((error) => {
    schemaReady = undefined;
    throw error;
  });

  return schemaReady;
}

async function migrateSchema(): Promise<void> {
  const client = await getPool().connect();

  try {
    await client.query("begin");
    await client.query(schemaLockSql);
    await client.query(`
    create table if not exists pages (
      page_key text primary key,
      notion_page_id text not null unique,
      notion_url text not null,
      current_hash text,
      status text not null default 'queued',
      dirty_at timestamptz,
      last_generated_at timestamptz,
      last_error text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    alter table pages
      add column if not exists slug text;

    alter table pages
      add column if not exists generation_step text,
      add column if not exists generation_progress integer not null default 0,
      add column if not exists generation_log jsonb not null default '[]'::jsonb,
      add column if not exists user_transformed_at timestamptz,
      add column if not exists preferred_language text not null default 'auto';

    update pages
      set slug = page_key
      where slug is null;

    update pages
      set user_transformed_at = created_at
      where user_transformed_at is null;

    alter table pages
      alter column slug set not null;

    create unique index if not exists pages_slug_key on pages(slug);

    create table if not exists page_versions (
      id bigserial primary key,
      page_key text not null references pages(page_key) on delete cascade,
      content_hash text not null,
      object_key text not null,
      document_json jsonb not null,
      generated_at timestamptz not null default now(),
      unique(page_key, content_hash)
    );

    create table if not exists user_sites (
      user_id text not null,
      page_key text not null references pages(page_key) on delete cascade,
      created_at timestamptz not null default now(),
      primary key(user_id, page_key)
    );

    create index if not exists user_sites_user_created_idx
      on user_sites(user_id, created_at desc);

    create table if not exists daily_site_usage (
      user_id text not null,
      usage_date date not null,
      used_count integer not null check (used_count >= 0),
      updated_at timestamptz not null default now(),
      primary key(user_id, usage_date)
    );
  `);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function query<T extends pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  await ensureSchema();
  const result = await getPool().query<T>(text, values);
  return result.rows;
}
