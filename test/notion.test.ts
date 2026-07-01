import { describe, expect, it, vi } from "vitest";
import {
  fetchNotionCommentsMarkdown,
  formatNotionId,
  notionUrlFromPathSegments,
  parseNotionPageId,
  slugFromNotionUrl,
} from "@/lib/notion";

describe("Notion page id parsing", () => {
  it("extracts compact ids from Notion URLs", () => {
    expect(
      parseNotionPageId(
        "https://www.notion.so/workspace/Test-0123456789abcdef0123456789abcdef?pvs=4",
      ),
    ).toBe("01234567-89ab-cdef-0123-456789abcdef");
  });

  it("keeps dashed ids stable", () => {
    expect(formatNotionId("01234567-89ab-cdef-0123-456789abcdef")).toBe(
      "01234567-89ab-cdef-0123-456789abcdef",
    );
  });

  it("extracts the public page slug before the id", () => {
    expect(
      slugFromNotionUrl(
        "https://app.notion.com/p/iosgvc/1Money-6-11-2026-EN-37cf0ada243c81279b43e3a1603c6a43",
      ),
    ).toBe("1Money-6-11-2026-EN");
  });

  it("keeps database view URLs pointed at the database page id", () => {
    expect(
      parseNotionPageId(
        "https://www.notion.so/workspace/Deals-11111111111111111111111111111111?v=22222222222222222222222222222222",
      ),
    ).toBe("11111111-1111-1111-1111-111111111111");
    expect(
      slugFromNotionUrl(
        "https://www.notion.so/workspace/Deals-11111111111111111111111111111111?v=22222222222222222222222222222222",
      ),
    ).toBe("Deals");
  });

  it("extracts database row page ids from the p query param", () => {
    expect(
      parseNotionPageId(
        "https://www.notion.so/workspace/Deals-11111111111111111111111111111111?v=22222222222222222222222222222222&p=33333333333333333333333333333333&pm=s",
      ),
    ).toBe("33333333-3333-3333-3333-333333333333");
    expect(
      slugFromNotionUrl(
        "https://www.notion.so/workspace/Deals-11111111111111111111111111111111?v=22222222222222222222222222222222&p=33333333333333333333333333333333&pm=s",
      ),
    ).toBe("33333333333333");
  });

  it("uses leaf page ids and slugs from nested subpage URLs", () => {
    expect(
      parseNotionPageId(
        "https://app.notion.com/p/workspace/Parent-11111111111111111111111111111111/Child-33333333333333333333333333333333",
      ),
    ).toBe("33333333-3333-3333-3333-333333333333");
    expect(
      slugFromNotionUrl(
        "https://app.notion.com/p/workspace/Parent-11111111111111111111111111111111/Child-33333333333333333333333333333333",
      ),
    ).toBe("Child");
  });

  it("normalizes a Notion URL pasted into the root path", () => {
    const cases = [
      {
        segments: [
          "https:",
          "app.notion.com",
          "p",
          "iosgvc",
          "1Money-6-11-2026-EN-37cf0ada243c81279b43e3a1603c6a43",
        ],
        expected: "https://app.notion.com/p/iosgvc/1Money-6-11-2026-EN-37cf0ada243c81279b43e3a1603c6a43",
      },
      {
        segments: [
          "https:",
          "www.notion.so",
          "workspace",
          "Different-Page-fedcba9876543210fedcba9876543210",
        ],
        expected: "https://www.notion.so/workspace/Different-Page-fedcba9876543210fedcba9876543210",
      },
    ];

    for (const testCase of cases) {
      expect(notionUrlFromPathSegments(testCase.segments)).toBe(testCase.expected);
    }
  });
});

describe("Notion comments", () => {
  it("fetches comments from child blocks and groups them by discussion", async () => {
    vi.stubEnv("NOTION_API_KEY", "ntn-test");
    vi.stubGlobal("fetch", vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));

      if (url.pathname.endsWith("/blocks/01234567-89ab-cdef-0123-456789abcdef/children")) {
        return new Response(JSON.stringify({
          results: [{
            id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            type: "paragraph",
            has_children: false,
            paragraph: {
              rich_text: [{ plain_text: "Asset quality：资产质量" }],
            },
          }],
          has_more: false,
        }), { status: 200 });
      }

      if (url.pathname.endsWith("/comments") && url.searchParams.get("block_id") === "01234567-89ab-cdef-0123-456789abcdef") {
        return new Response(JSON.stringify({ results: [], has_more: false }), { status: 200 });
      }

      if (url.pathname.endsWith("/comments") && url.searchParams.get("block_id") === "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") {
        return new Response(JSON.stringify({
          results: [
            {
              id: "comment-1",
              discussion_id: "discussion-1",
              created_time: "2026-05-11T05:25:56.825Z",
              rich_text: [{ plain_text: "Money market fund comes after treasury products." }],
            },
            {
              id: "comment-2",
              discussion_id: "discussion-1",
              created_time: "2026-05-11T05:26:20.542Z",
              rich_text: [{ plain_text: "Composability is a major selling point." }],
            },
          ],
          has_more: false,
        }), { status: 200 });
      }

      return new Response("unexpected", { status: 404 });
    }));

    const result = await fetchNotionCommentsMarkdown(
      "https://app.notion.com/p/ws/Page-0123456789abcdef0123456789abcdef",
    );

    expect(result.commentCount).toBe(2);
    expect(result.discussionCount).toBe(1);
    expect(result.markdown).toContain("## Notion comments");
    expect(result.markdown).toContain("Asset quality");
    expect(result.markdown).toContain("Money market fund comes after treasury products.");
    expect(result.markdown).toContain("Composability is a major selling point.");

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
