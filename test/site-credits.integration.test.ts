import { afterAll, describe, expect, it } from "vitest";

const runIntegration = process.env.RUN_DB_INTEGRATION === "1";

describe.skipIf(!runIntegration)("daily site credits with PostgreSQL", () => {
  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
  });

  it("allows exactly two concurrent site creations per UTC day", async () => {
    const { createUserSiteFromNotionUrl, DailySiteLimitError } = await import("@/lib/site-credits");
    const urls = [
      "https://notion.so/One-11111111111111111111111111111111",
      "https://notion.so/Two-22222222222222222222222222222222",
      "https://notion.so/Three-33333333333333333333333333333333",
    ];

    const results = await Promise.allSettled(urls.map((notionUrl) => createUserSiteFromNotionUrl({
      notionUrl,
      userId: "concurrent-user",
      email: "reader@example.com",
    })));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    const rejection = results.find((result) => result.status === "rejected");
    expect(rejection).toBeDefined();
    if (rejection?.status === "rejected") {
      expect(rejection.reason).toBeInstanceOf(DailySiteLimitError);
    }

    const { query } = await import("@/lib/db");
    const usage = await query<{ used_count: number }>(
      "select used_count from daily_site_usage where user_id = $1",
      ["concurrent-user"],
    );
    const sites = await query<{ count: string }>(
      "select count(*) from user_sites where user_id = $1",
      ["concurrent-user"],
    );

    expect(usage[0]?.used_count).toBe(2);
    expect(Number(sites[0]?.count)).toBe(2);
  });

  it("does not charge twice for the same site and leaves IOSG unlimited", async () => {
    const { createUserSiteFromNotionUrl, getUserSiteQuota } = await import("@/lib/site-credits");
    const notionUrl = "https://notion.so/Shared-44444444444444444444444444444444";

    const first = await createUserSiteFromNotionUrl({
      notionUrl,
      userId: "duplicate-user",
      email: "reader@example.com",
    });
    const second = await createUserSiteFromNotionUrl({
      notionUrl,
      userId: "duplicate-user",
      email: "reader@example.com",
    });

    expect(first.siteCreated).toBe(true);
    expect(second.siteCreated).toBe(false);
    expect((await getUserSiteQuota("duplicate-user", "reader@example.com")).used).toBe(1);

    const iosgResults = await Promise.all([5, 6, 7].map((digit) => createUserSiteFromNotionUrl({
      notionUrl: `https://notion.so/IOSG-${String(digit).repeat(32)}`,
      userId: "iosg-user",
      email: "member@iosg.vc",
    })));

    expect(iosgResults.every((result) => result.siteCreated)).toBe(true);
    expect((await getUserSiteQuota("iosg-user", "member@iosg.vc")).unlimited).toBe(true);
  });
});
