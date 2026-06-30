import { beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import { listRecentPages, upsertPageFromNotionUrl } from "@/lib/page-store";

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

    expect(vi.mocked(query).mock.calls[0][1]?.at(-1)).toBe(true);
  });
});
