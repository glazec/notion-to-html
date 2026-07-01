import { getBinaryObject } from "@/lib/bucket";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ assetPath: string[] }> },
) {
  const { assetPath } = await context.params;
  const key = ["assets", ...assetPath].join("/");
  const asset = await getBinaryObject(key);

  return new Response(Buffer.from(asset.body), {
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      ...(asset.contentType === "image/svg+xml" ? { "Content-Disposition": "attachment" } : {}),
    },
  });
}
