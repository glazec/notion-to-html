import { beforeEach, describe, expect, it, vi } from "vitest";

const putBinaryObject = vi.fn();
const describeImageAsset = vi.fn();
const lookup = vi.fn();
const undiciFetch = vi.fn();
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

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: undiciFetch,
  };
});

describe("source asset preparation", () => {
  beforeEach(() => {
    putBinaryObject.mockReset();
    describeImageAsset.mockReset();
    lookup.mockReset();
    undiciFetch.mockReset();
    lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    vi.unstubAllGlobals();
  });

  it("stores source images locally and adds Codex descriptions to markdown", async () => {
    undiciFetch.mockResolvedValue(new Response(pngBytes, {
      status: 200,
      headers: { "content-type": "image/png" },
    }));
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("global fetch should not be used for source image downloads");
    }));
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
    expect(result.images).toHaveLength(1);
    expect(result.skippedImages).toEqual([]);
    expect(result.markdown).toContain("![Product demo](/assets/pages/37cf0ada243c81279b43e3a1603c6a43/images/");
    expect(result.markdown).toContain("Codex image description: A product demo showing the 1Money settlement workflow.");
  });

  it("skips private network image URLs before fetching", async () => {
    const { prepareSourceAssets } = await import("@/lib/source-assets");
    const result = await prepareSourceAssets({
      pageId: "37cf0ada243c81279b43e3a1603c6a43",
      markdown: "![Internal](https://127.0.0.1/admin.png)",
    });

    expect(undiciFetch).not.toHaveBeenCalled();
    expect(result.images).toEqual([]);
    expect(result.skippedImages).toEqual([expect.objectContaining({
      alt: "Internal",
      reason: "Image URL is not allowed.",
    })]);
    expect(result.markdown).toContain("[Skipped image: Internal]");
    expect(result.markdown).not.toContain("https://127.0.0.1/admin.png");
  });

  it("skips private ipv6 literal image URLs before fetching", async () => {
    const { prepareSourceAssets } = await import("@/lib/source-assets");
    const result = await prepareSourceAssets({
      pageId: "37cf0ada243c81279b43e3a1603c6a43",
      markdown: "![Internal](https://[::1]/admin.png)",
    });

    expect(undiciFetch).not.toHaveBeenCalled();
    expect(result.images).toEqual([]);
    expect(result.skippedImages).toEqual([expect.objectContaining({
      alt: "Internal",
      reason: "Image URL is not allowed.",
    })]);
    expect(result.markdown).not.toContain("https://[::1]/admin.png");
  });


  it("skips redirects to private network image URLs before following them", async () => {
    undiciFetch.mockImplementation(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => new Response(null, {
      status: 302,
      headers: { location: "https://169.254.169.254/latest/meta-data.png" },
    }));

    const { prepareSourceAssets } = await import("@/lib/source-assets");
    const result = await prepareSourceAssets({
      pageId: "37cf0ada243c81279b43e3a1603c6a43",
      markdown: "![Redirect](https://example.com/redirect.png)",
    });

    expect(undiciFetch).toHaveBeenCalledTimes(1);
    expect(undiciFetch.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    expect(undiciFetch.mock.calls[0][1]).toHaveProperty("dispatcher");
    expect(result.images).toEqual([]);
    expect(result.skippedImages).toEqual([expect.objectContaining({
      alt: "Redirect",
      reason: "Image URL is not allowed.",
    })]);
    expect(result.markdown).not.toContain("https://example.com/redirect.png");
  });

  it.each([
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "::ffff:0a00:0001",
    "::ffff:7f00:1",
  ])("skips dns results with private ipv4 mapped ipv6 address %s", async (address) => {
    lookup.mockResolvedValue([{ address, family: 6 }]);
    const { prepareSourceAssets } = await import("@/lib/source-assets");
    const result = await prepareSourceAssets({
      pageId: "37cf0ada243c81279b43e3a1603c6a43",
      markdown: "![Mapped](https://example.com/mapped.png)",
    });

    expect(undiciFetch).not.toHaveBeenCalled();
    expect(result.images).toEqual([]);
    expect(result.skippedImages).toEqual([expect.objectContaining({
      alt: "Mapped",
      reason: "Image URL is not allowed.",
    })]);
  });

  it("returns an address array when the dispatcher asks lookup for all addresses", async () => {
    lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
    const { safeLookup } = await import("@/lib/source-assets");
    const result = await new Promise<unknown[]>((resolve) => {
      safeLookup("example.com", { all: true } as never, (...args) => resolve(args));
    });

    expect(result).toEqual([
      null,
      [
        { address: "93.184.216.34", family: 4 },
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      ],
    ]);
  });

  it("returns one address and family for single-address lookup callers", async () => {
    const { safeLookup } = await import("@/lib/source-assets");
    const result = await new Promise<unknown[]>((resolve) => {
      safeLookup("example.com", {} as never, (...args) => resolve(args));
    });

    expect(result).toEqual([null, "93.184.216.34", 4]);
  });

  it("stores svg image payloads without running image description", async () => {
    const svgBytes = new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"><text>Private AI</text></svg>");
    undiciFetch.mockResolvedValue(new Response(svgBytes, {
      status: 200,
      headers: { "content-type": "image/svg+xml" },
    }));

    const { prepareSourceAssets } = await import("@/lib/source-assets");
    const result = await prepareSourceAssets({
      pageId: "37cf0ada243c81279b43e3a1603c6a43",
      markdown: "![Svg](https://example.com/demo.svg)",
    });

    expect(putBinaryObject).toHaveBeenCalledWith(
      expect.stringMatching(/^assets\/pages\/37cf0ada243c81279b43e3a1603c6a43\/images\/[a-f0-9]+\.svg$/),
      svgBytes,
      "image/svg+xml",
    );
    expect(describeImageAsset).not.toHaveBeenCalled();
    expect(result.images).toHaveLength(1);
    expect(result.skippedImages).toEqual([]);
    expect(result.markdown).toContain("![Svg](/assets/pages/37cf0ada243c81279b43e3a1603c6a43/images/");
    expect(result.markdown).toContain("Codex image description: SVG diagram from the Notion page labeled \"Svg\".");
  });

  it("skips non-svg payloads served as svg", async () => {
    undiciFetch.mockResolvedValue(new Response("<html></html>", {
      status: 200,
      headers: { "content-type": "image/svg+xml" },
    }));

    const { prepareSourceAssets } = await import("@/lib/source-assets");
    const result = await prepareSourceAssets({
      pageId: "37cf0ada243c81279b43e3a1603c6a43",
      markdown: "![Svg](https://example.com/demo.svg)",
    });

    expect(result.images).toEqual([]);
    expect(result.skippedImages).toEqual([expect.objectContaining({
      alt: "Svg",
      reason: "Unsupported image type.",
    })]);
  });

  it("skips oversized image bodies while streaming", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream({
      start(controller) {
        for (let index = 0; index < 6; index += 1) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
    undiciFetch.mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { "content-type": "image/png" },
    }));

    const { prepareSourceAssets } = await import("@/lib/source-assets");
    const result = await prepareSourceAssets({
      pageId: "37cf0ada243c81279b43e3a1603c6a43",
      markdown: "![Large](https://example.com/large.png)",
    });

    expect(result.images).toEqual([]);
    expect(result.skippedImages).toEqual([expect.objectContaining({
      alt: "Large",
      reason: "Image is too large.",
    })]);
    expect(result.markdown).not.toContain("https://example.com/large.png");
  });
});
