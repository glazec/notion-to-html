import { describe, expect, it } from "vitest";
import {
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
