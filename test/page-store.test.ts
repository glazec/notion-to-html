import { beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import {
  completePageGeneration,
  InvalidNotionUrlError,
  listRecentPages,
  setPageGenerationProgress,
  setPageStatus,
  upsertPageFromNotionUrl,
} from "@/lib/page-store";

vi.mock("@/lib/db", () => ({
  query: vi.fn(async () => []),
}));

describe("page store", () => {
  beforeEach(() => {
    vi.mocked(query).mockClear();
  });

  it("lists only pages transformed by users", async () => {
    await listRecentPages();

    expect(vi.mocked(query).mock.calls[0][0]).toContain("where user_transformed_at is not null");
  });

  it("marks form submitted pages as user transformed", async () => {
    vi.mocked(query).mockResolvedValueOnce([
      {
        page_key: "0123456789abcd",
        slug: "Test",
        notion_page_id: "01234567-89ab-cdef-0123-456789abcdef",
        notion_url: "https://app.notion.com/p/workspace/Test-0123456789abcdef0123456789abcdef",
        current_hash: null,
        status: "queued",
        dirty_at: null,
        last_generated_at: null,
        generation_step: "Queued",
        generation_progress: 0,
        user_transformed_at: new Date(),
        last_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    await upsertPageFromNotionUrl(
      "https://app.notion.com/p/workspace/Test-0123456789abcdef0123456789abcdef",
      { userTransformed: true },
    );

    expect(vi.mocked(query).mock.calls[0][1]?.[4]).toBe(true);
  });

  it("rejects non Notion hosts before inserting a page", async () => {
    await expect(upsertPageFromNotionUrl(
      "https://evil.example/Test-0123456789abcdef0123456789abcdef",
    )).rejects.toBeInstanceOf(InvalidNotionUrlError);

    await expect(upsertPageFromNotionUrl(
      "0123456789abcdef0123456789abcdef",
    )).rejects.toBeInstanceOf(InvalidNotionUrlError);

    expect(vi.mocked(query)).not.toHaveBeenCalled();
  });

  it("appends generation progress to the persisted page log", async () => {
    vi.mocked(query).mockResolvedValueOnce([
      {
        page_key: "0123456789abcd",
        slug: "Test",
        notion_page_id: "01234567-89ab-cdef-0123-456789abcdef",
        notion_url: "https://app.notion.com/p/workspace/Test-0123456789abcdef0123456789abcdef",
        current_hash: null,
        status: "generating",
        dirty_at: null,
        last_generated_at: null,
        generation_step: "Rendering HTML",
        generation_progress: 75,
        generation_log: [
          {
            at: "2026-07-01T00:10:30.000Z",
            status: "generating",
            step: "Rendering HTML",
            progress: 75,
          },
        ],
        user_transformed_at: new Date(),
        last_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    await setPageGenerationProgress({
      pageKey: "0123456789abcd",
      status: "generating",
      step: "Rendering HTML",
      progress: 75,
    });

    const sql = vi.mocked(query).mock.calls[0][0];
    const values = vi.mocked(query).mock.calls[0][1] ?? [];
    expect(sql).toContain("generation_log");
    expect(sql).toContain("jsonb_build_array");
    expect(sql).toContain("$5::jsonb");
    expect(JSON.parse(String(values[4]))).toMatchObject({
      status: "generating",
      step: "Rendering HTML",
      progress: 75,
    });
  });

  it("redacts sensitive values from persisted progress logs", async () => {
    vi.mocked(query).mockResolvedValueOnce([pageRecord({
      generation_step: "Fetching [url redacted] with [secret redacted]",
    })]);

    await setPageGenerationProgress({
      pageKey: "0123456789abcd",
      status: "generating",
      step: "Fetching https://example.com/image.png?token=secret with Authorization: Bearer sk-test-secret using fc-abcdefghijklmnopqrstuvwxyz123456",
      progress: 25,
    });

    const values = vi.mocked(query).mock.calls[0][1] ?? [];
    const logEntry = JSON.parse(String(values[4]));
    expect(values[2]).toBe("Fetching [url redacted] with Authorization: Bearer [redacted] using [redacted]");
    expect(logEntry.step).toBe("Fetching [url redacted] with Authorization: Bearer [redacted] using [redacted]");
    expect(String(values[2])).not.toContain("secret");
    expect(JSON.stringify(logEntry)).not.toContain("https://example.com");
    expect(JSON.stringify(logEntry)).not.toContain("sk-test");
    expect(JSON.stringify(logEntry)).not.toContain("fc-");
  });

  it("redacts sensitive values from persisted failure logs", async () => {
    vi.mocked(query).mockResolvedValueOnce([pageRecord({
      status: "failed",
      last_error: "Request failed for [url redacted] with token [secret redacted]",
    })]);

    await setPageStatus(
      "0123456789abcd",
      "failed",
      "Request failed for postgresql://postgres:password@example.com:5432/app with token ntn_abcdefghijklmnopqrstuvwxyz123456",
    );

    const values = vi.mocked(query).mock.calls[0][1] ?? [];
    const logEntry = JSON.parse(String(values[3]));
    expect(values[2]).toBe("Request failed for [url redacted] with token [redacted]");
    expect(logEntry.step).toBe("Request failed for [url redacted] with token [redacted]");
    expect(String(values[2])).not.toContain("postgresql://");
    expect(String(values[2])).not.toContain("password");
    expect(JSON.stringify(logEntry)).not.toContain("ntn_");
  });

  it("keeps pages queued when they were marked dirty after generation started", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([pageRecord({
        status: "queued",
        dirty_at: new Date("2026-07-01T00:01:00.000Z"),
      })]);

    const generationStartedAt = new Date("2026-07-01T00:00:00.000Z");
    await completePageGeneration({
      pageKey: "0123456789abcd",
      contentHash: "hash",
      objectKey: "pages/1/index.html",
      documentJson: {
        schema_version: 1,
        title: "Test",
        notionUrl: "https://notion.so/test",
        theme: "light",
        sections: [{ type: "hero", heading: "Test", blocks: [] }],
      },
      generationStartedAt,
    });

    const updateSql = vi.mocked(query).mock.calls[1][0];
    const values = vi.mocked(query).mock.calls[1][1] ?? [];
    expect(updateSql).toContain("dirty_at > $4");
    expect(updateSql).toContain("status = case");
    expect(updateSql).toContain("dirty_at = case");
    expect(values[3]).toBe(generationStartedAt);
  });
});

function pageRecord(overrides: Record<string, unknown> = {}) {
  return {
    page_key: "0123456789abcd",
    slug: "Test",
    notion_page_id: "01234567-89ab-cdef-0123-456789abcdef",
    notion_url: "https://app.notion.com/p/workspace/Test-0123456789abcdef0123456789abcdef",
    current_hash: null,
    status: "generating",
    dirty_at: null,
    last_generated_at: null,
    generation_step: "Rendering HTML",
    generation_progress: 75,
    generation_log: [],
    user_transformed_at: new Date(),
    last_error: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}
