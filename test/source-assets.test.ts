import { beforeEach, describe, expect, it, vi } from "vitest";

const putBinaryObject = vi.fn();
const describeImageAsset = vi.fn();

vi.mock("@/lib/bucket", () => ({
  putBinaryObject,
}));

vi.mock("@/lib/codex-generator", () => ({
  describeImageAsset,
}));

describe("source asset preparation", () => {
  beforeEach(() => {
    putBinaryObject.mockReset();
    describeImageAsset.mockReset();
    vi.unstubAllGlobals();
  });

  it("stores source images locally and adds Codex descriptions to markdown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("image-bytes", {
      status: 200,
      headers: { "content-type": "image/png" },
    })));
    describeImageAsset.mockResolvedValue("A product demo showing the 1Money settlement workflow.");

    const { prepareSourceAssets } = await import("@/lib/source-assets");
    const result = await prepareSourceAssets({
      pageId: "37cf0ada243c81279b43e3a1603c6a43",
      markdown: [
        "# 1Money",
        "![Product demo](https://example.com/demo.png)",
      ].join("\n\n"),
    });

    expect(putBinaryObject).toHaveBeenCalledWith(
      expect.stringMatching(/^assets\/pages\/37cf0ada243c81279b43e3a1603c6a43\/images\/[a-f0-9]+\.png$/),
      expect.any(Uint8Array),
      "image/png",
    );
    expect(describeImageAsset).toHaveBeenCalledWith(expect.objectContaining({
      altText: "Product demo",
      sourceUrl: "https://example.com/demo.png",
    }));
    expect(result.markdown).toContain("![Product demo](/assets/pages/37cf0ada243c81279b43e3a1603c6a43/images/");
    expect(result.markdown).toContain("Codex image description: A product demo showing the 1Money settlement workflow.");
  });
});
