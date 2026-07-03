import { beforeEach, describe, expect, it, vi } from "vitest";

describe("database schema", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("retries schema initialization after a failed attempt", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/app");

    let failedOnce = false;
    const query = vi.fn(async (sql: string) => {
      if (!failedOnce && sql.includes("create table")) {
        failedOnce = true;
        throw new Error("schema race");
      }

      return { rows: [] };
    });

    const client = {
      query,
      release: vi.fn(),
    };

    class FakePool {
      query = query;
      connect = vi.fn(async () => client);
    }

    vi.doMock("pg", () => ({
      default: { Pool: FakePool },
    }));

    const { ensureSchema } = await import("@/lib/db");

    await expect(ensureSchema()).rejects.toThrow("schema race");
    await expect(ensureSchema()).resolves.toBeUndefined();
    expect(failedOnce).toBe(true);
  });

  it("migrates pages with an auto language preference by default", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/app");

    const statements: string[] = [];
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      return { rows: [] };
    });

    const client = {
      query,
      release: vi.fn(),
    };

    class FakePool {
      query = query;
      connect = vi.fn(async () => client);
    }

    vi.doMock("pg", () => ({
      default: { Pool: FakePool },
    }));

    const { ensureSchema } = await import("@/lib/db");
    await ensureSchema();

    expect(statements.join("\n")).toContain("preferred_language text not null default 'auto'");
  });
});
