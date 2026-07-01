import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { putBinaryObject } from "@/lib/bucket";
import { describeImageAsset } from "@/lib/codex-generator";

type SourceImage = {
  alt: string;
  sourceUrl: string;
};

type StoredImage = SourceImage & {
  localUrl: string;
  objectKey: string;
  description: string;
};

const markdownImagePattern = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;

export async function prepareSourceAssets(input: {
  pageId: string;
  markdown: string;
}): Promise<{
  markdown: string;
  images: StoredImage[];
}> {
  const images = uniqueImages(extractMarkdownImages(input.markdown)).slice(0, 20);
  if (images.length === 0) {
    return { markdown: input.markdown, images: [] };
  }

  const storedImages: StoredImage[] = [];
  let markdown = input.markdown;

  for (const image of images) {
    const stored = await storeAndDescribeImage(input.pageId, image);
    storedImages.push(stored);
    markdown = markdown.replaceAll(image.sourceUrl, stored.localUrl);
  }

  return {
    markdown: appendImageDescriptions(markdown, storedImages),
    images: storedImages,
  };
}

function extractMarkdownImages(markdown: string): SourceImage[] {
  return [...markdown.matchAll(markdownImagePattern)].map((match) => ({
    alt: match[1]?.trim() || "Image",
    sourceUrl: match[2],
  }));
}

function uniqueImages(images: SourceImage[]): SourceImage[] {
  const seen = new Set<string>();
  return images.filter((image) => {
    if (seen.has(image.sourceUrl)) return false;
    seen.add(image.sourceUrl);
    return true;
  });
}

async function storeAndDescribeImage(pageId: string, image: SourceImage): Promise<StoredImage> {
  const response = await fetch(image.sourceUrl);
  if (!response.ok) {
    throw new Error(`Image fetch failed: ${response.status} ${image.sourceUrl}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = normalizedImageContentType(response.headers.get("content-type"), image.sourceUrl);
  const objectKey = `assets/pages/${pageId}/images/${hashImage(bytes, image.sourceUrl)}${extensionForImage(contentType, image.sourceUrl)}`;
  const localUrl = `/${objectKey}`;
  await putBinaryObject(objectKey, bytes, contentType);

  const imagePath = await writeTempImage(bytes, extensionForImage(contentType, image.sourceUrl));
  try {
    const description = await describeImageAsset({
      imagePath,
      altText: image.alt,
      sourceUrl: image.sourceUrl,
    });

    return {
      ...image,
      localUrl,
      objectKey,
      description,
    };
  } finally {
    await rm(dirname(imagePath), { recursive: true, force: true }).catch(() => undefined);
  }
}

function appendImageDescriptions(markdown: string, images: StoredImage[]): string {
  const lines = images.map((image, index) => [
    `### Image ${index + 1}: ${image.alt}`,
    `Local image: ${image.localUrl}`,
    `Original image: ${image.sourceUrl}`,
    `Codex image description: ${image.description}`,
  ].join("\n"));

  return [
    markdown,
    "## Visual assets",
    ...lines,
  ].join("\n\n");
}

function normalizedImageContentType(contentType: string | null, sourceUrl: string): string {
  const value = contentType?.split(";")[0]?.trim().toLowerCase();
  if (value?.startsWith("image/")) return value;

  const extension = extname(new URL(sourceUrl).pathname).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".svg") return "image/svg+xml";
  return "image/png";
}

function extensionForImage(contentType: string, sourceUrl: string): string {
  if (contentType === "image/png") return ".png";
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/gif") return ".gif";
  if (contentType === "image/webp") return ".webp";
  if (contentType === "image/svg+xml") return ".svg";

  const extension = extname(new URL(sourceUrl).pathname).toLowerCase();
  return extension || ".png";
}

function hashImage(bytes: Uint8Array, sourceUrl: string): string {
  return createHash("sha256")
    .update(sourceUrl)
    .update(bytes)
    .digest("hex")
    .slice(0, 24);
}

async function writeTempImage(bytes: Uint8Array, extension: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "notion-to-html-image-"));
  const imagePath = join(dir, `image${extension}`);
  await writeFile(imagePath, bytes);
  return imagePath;
}
