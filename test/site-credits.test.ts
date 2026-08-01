import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureSchema = vi.fn();
const query = vi.fn();
const clientQuery = vi.fn();
const release = vi.fn();

vi.mock("@/lib/db", () => ({
  ensureSchema,
  getPool: () => ({ connect: async () => ({ query: clientQuery, release }) }),
  query,
}));

describe("daily site credits", () => {
  beforeEach(() => {
    ensureSchema.mockReset();
    query.mockReset();
    clientQuery.mockReset();
    release.mockReset();
  });

  it("recognizes only the exact IOSG email domain as unlimited", async () => {
    const { hasUnlimitedSites } = await import("@/lib/site-credits");

    expect(hasUnlimitedSites("PERSON@IOSG.VC")).toBe(true);
    expect(hasUnlimitedSites("person@sub.iosg.vc")).toBe(false);
    expect(hasUnlimitedSites("person@iosg.vc.example")).toBe(false);
  });

  it("reserves a credit and creates the user site in one transaction", async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("from user_sites")) return { rows: [] };
      if (sql.includes("insert into daily_site_usage")) return { rows: [{ used_count: 1 }] };
      if (sql.includes("insert into pages")) return { rows: [pageRecord()] };
      return { rows: [] };
    });

    const { createUserSiteFromNotionUrl } = await import("@/lib/site-credits");
    const result = await createUserSiteFromNotionUrl({
      notionUrl: "https://notion.so/Test-0123456789abcdef0123456789abcdef",
      userId: "user-1",
      email: "reader@example.com",
    });

    expect(result.siteCreated).toBe(true);
    expect(result.page.page_key).toBe("0123456789abcd");
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes("pg_advisory_xact_lock"))).toBe(true);
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes("used_count < $2"))).toBe(true);
    expect(clientQuery).toHaveBeenLastCalledWith("commit");
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not spend a credit when the same user already owns the site", async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("from user_sites")) return { rows: [pageRecord()] };
      return { rows: [] };
    });

    const { createUserSiteFromNotionUrl } = await import("@/lib/site-credits");
    const result = await createUserSiteFromNotionUrl({
      notionUrl: "https://notion.so/Test-0123456789abcdef0123456789abcdef",
      userId: "user-1",
      email: "reader@example.com",
    });

    expect(result.siteCreated).toBe(false);
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes("daily_site_usage"))).toBe(false);
  });

  it("rolls back when the daily limit is exhausted", async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("from user_sites")) return { rows: [] };
      if (sql.includes("insert into daily_site_usage")) return { rows: [] };
      return { rows: [] };
    });

    const { createUserSiteFromNotionUrl, DailySiteLimitError } = await import("@/lib/site-credits");
    await expect(createUserSiteFromNotionUrl({
      notionUrl: "https://notion.so/Test-0123456789abcdef0123456789abcdef",
      userId: "user-1",
      email: "reader@example.com",
    })).rejects.toBeInstanceOf(DailySiteLimitError);

    expect(clientQuery).toHaveBeenLastCalledWith("rollback");
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes("insert into pages"))).toBe(false);
  });

  it("skips the usage table for IOSG accounts", async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("from user_sites")) return { rows: [] };
      if (sql.includes("insert into pages")) return { rows: [pageRecord()] };
      return { rows: [] };
    });

    const { createUserSiteFromNotionUrl } = await import("@/lib/site-credits");
    await createUserSiteFromNotionUrl({
      notionUrl: "https://notion.so/Test-0123456789abcdef0123456789abcdef",
      userId: "user-iosg",
      email: "member@iosg.vc",
    });

    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes("daily_site_usage"))).toBe(false);
  });

  it("uses a stable page key suffix when a public slug is already taken", async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("from user_sites")) return { rows: [] };
      if (sql.includes("insert into daily_site_usage")) return { rows: [{ used_count: 1 }] };
      if (sql.includes("select coalesce")) return { rows: [{ slug: "Test-0123456789abcd" }] };
      if (sql.includes("insert into pages")) return { rows: [{ ...pageRecord(), slug: "Test-0123456789abcd" }] };
      return { rows: [] };
    });

    const { createUserSiteFromNotionUrl } = await import("@/lib/site-credits");
    const result = await createUserSiteFromNotionUrl({
      notionUrl: "https://notion.so/Test-0123456789abcdef0123456789abcdef",
      userId: "user-1",
      email: "reader@example.com",
    });

    expect(result.page.slug).toBe("Test-0123456789abcd");
    expect(clientQuery.mock.calls.some(([, values]) => Array.isArray(values) && values[1] === "Test-0123456789abcd")).toBe(true);
  });
});

function pageRecord() {
  return {
    page_key: "0123456789abcd",
    slug: "Test",
    notion_page_id: "01234567-89ab-cdef-0123-456789abcdef",
    notion_url: "https://notion.so/Test-0123456789abcdef0123456789abcdef",
    current_hash: null,
    status: "queued",
    dirty_at: null,
    last_generated_at: null,
    generation_step: "Queued",
    generation_progress: 0,
    generation_log: [],
    user_transformed_at: new Date(),
    preferred_language: "auto",
    last_error: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}
