import { beforeEach, describe, expect, it, vi } from "vitest";

const putBinaryObject = vi.fn();
const describeImageAsset = vi.fn();
const lookup = vi.fn();
const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d,
]);

vi.mock("@/lib/bucket", () => ({
  putBinaryObject,
}));

vi.mock("@/lib/codex-generator", () => ({
  describeImageAsset,
}));

vi.mock("node:dns/promises", () => ({
  lookup,
}));

describe("source asset preparation", () => {
  beforeEach(() => {
    putBinaryObject.mockReset();
    describeImageAsset.mockReset();
    lookup.mockReset();
    lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    vi.unstubAllGlobals();
  });

  it("stores source images locally and adds Codex descriptions to markdown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(pngBytes, {
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

  it("rejects private network image URLs before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { prepareSourceAssets } = await import("@/lib/source-assets");
    await expect(prepareSourceAssets({
      pageId: "37cf0ada243c81279b43e3a1603c6a43",
      markdown: "![Internal](https://127.0.0.1/admin.png)",
    })).rejects.toThrow("Image URL is not allowed");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects private ipv6 literal image URLs before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { prepareSourceAssets } = await import("@/lib/source-assets");
    await expect(prepareSourceAssets({
      pageId: "37cf0ada243c81279b43e3a1603c6a43",
      markdown: "![Internal](https://[::1]/admin.png)",
    })).rejects.toThrow("Image URL is not allowed");

    expect(fetchMock).not.toHaveBeenCalled();
  });


  it("rejects redirects to private network image URLs before following them", async () => {
    const fetchMock = vi.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => new Response(null, {
      status: 302,
      headers: { location: "https://169.254.169.254/latest/meta-data.png" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { prepareSourceAssets } = await import("@/lib/source-assets");
    await expect(prepareSourceAssets({
      pageId: "37cf0ada243c81279b43e3a1603c6a43",
      markdown: "![Redirect](https://example.com/redirect.png)",
    })).rejects.toThrow("Image URL is not allowed");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    expect(fetchMock.mock.calls[0][1]).toHaveProperty("dispatcher");
  });

  it.each([
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "::ffff:0a00:0001",
    "::ffff:7f00:1",
  ])("rejects dns results with private ipv4 mapped ipv6 address %s", async (address) => {
    lookup.mockResolvedValue([{ address, family: 6 }]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { prepareSourceAssets } = await import("@/lib/source-assets");
    await expect(prepareSourceAssets({
      pageId: "37cf0ada243c81279b43e3a1603c6a43",
      markdown: "![Mapped](https://example.com/mapped.png)",
    })).rejects.toThrow("Image URL is not allowed");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects svg image payloads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<svg onload=\"bad()\"></svg>", {
      status: 200,
      headers: { "content-type": "image/svg+xml" },
    })));

    const { prepareSourceAssets } = await import("@/lib/source-assets");
    await expect(prepareSourceAssets({
      pageId: "37cf0ada243c81279b43e3a1603c6a43",
      markdown: "![Svg](https://example.com/demo.svg)",
    })).rejects.toThrow("Unsupported image type");
  });

  it("rejects oversized image bodies while streaming", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream({
      start(controller) {
        for (let index = 0; index < 6; index += 1) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, {
      status: 200,
      headers: { "content-type": "image/png" },
    })));

    const { prepareSourceAssets } = await import("@/lib/source-assets");
    await expect(prepareSourceAssets({
      pageId: "37cf0ada243c81279b43e3a1603c6a43",
      markdown: "![Large](https://example.com/large.png)",
    })).rejects.toThrow("Image is too large");
  });
});
