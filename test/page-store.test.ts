import { beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import { listRecentPages, setPageGenerationProgress, upsertPageFromNotionUrl } from "@/lib/page-store";

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
});
