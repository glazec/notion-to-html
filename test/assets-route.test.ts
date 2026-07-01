import { beforeEach, describe, expect, it, vi } from "vitest";

const getBinaryObject = vi.fn();

vi.mock("@/lib/bucket", () => ({
  getBinaryObject,
}));

describe("asset route", () => {
  beforeEach(() => {
    getBinaryObject.mockReset();
  });

  it("serves stored svg assets as attachments with nosniff", async () => {
    getBinaryObject.mockResolvedValue({
      body: new TextEncoder().encode("<svg></svg>"),
      contentType: "image/svg+xml",
    });

    const { GET } = await import("@/app/assets/[...assetPath]/route");
    const response = await GET(
      new Request("https://notion-to-html.test/assets/pages/page-id/images/demo.svg"),
      { params: Promise.resolve({ assetPath: ["pages", "page-id", "images", "demo.svg"] }) },
    );

    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("content-disposition")).toBe("attachment");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
