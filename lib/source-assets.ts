import { createHash } from "node:crypto";
import type { LookupOptions } from "node:dns";
import { lookup } from "node:dns/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { Agent, fetch as undiciFetch } from "undici";
import { putBinaryObject } from "@/lib/bucket";
import { describeImageAsset } from "@/lib/codex-generator";
import { isDecorativeEmojiImage } from "@/lib/image-filter";

type SourceImage = {
  alt: string;
  sourceUrl: string;
};

type StoredImage = SourceImage & {
  localUrl: string;
  objectKey: string;
  description: string;
};

type SkippedImage = SourceImage & {
  reason: string;
};

type ImageFetchResponse = Awaited<ReturnType<typeof undiciFetch>>;
type SafeLookupAddress = { address: string; family: number };
type SafeLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | SafeLookupAddress[],
  family?: number,
) => void;

const markdownImagePattern = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const maxImageBytes = 5 * 1024 * 1024;
const imageFetchTimeoutMs = 15_000;
const maxImageRedirects = 3;
const safeImageDispatcher = new Agent({
  connect: {
    lookup: safeLookup,
  },
});

export async function prepareSourceAssets(input: {
  pageId: string;
  markdown: string;
}): Promise<{
  markdown: string;
  images: StoredImage[];
  skippedImages: SkippedImage[];
}> {
  const extractedImages = uniqueImages(extractMarkdownImages(input.markdown));
  const ignoredImages = extractedImages.filter(isDecorativeEmojiImage);
  const images = extractedImages.filter((image) => !isDecorativeEmojiImage(image)).slice(0, 20);
  let markdown = ignoredImages.reduce(
    (value, image) => removeImageMarkdown(value, image, ""),
    input.markdown,
  );
  if (images.length === 0) {
    return { markdown, images: [], skippedImages: [] };
  }

  const storedImages: StoredImage[] = [];
  const skippedImages: SkippedImage[] = [];

  for (const image of images) {
    try {
      const stored = await storeAndDescribeImage(input.pageId, image);
      storedImages.push(stored);
      markdown = markdown.replaceAll(image.sourceUrl, stored.localUrl);
    } catch (error) {
      const skipped = {
        ...image,
        reason: imageSkipReason(error),
      };
      skippedImages.push(skipped);
      markdown = removeImageMarkdown(markdown, skipped);
    }
  }

  return {
    markdown: appendImageDescriptions(markdown, storedImages, skippedImages),
    images: storedImages,
    skippedImages,
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
  const response = await fetchImage(image.sourceUrl);
  if (!response.ok) {
    throw new Error(`Image fetch failed: ${response.status} ${image.sourceUrl}`);
  }

  const bytes = await readImageBytes(response);
  const contentType = detectImageContentType(bytes, response.headers.get("content-type"), image.sourceUrl);
  const objectKey = `assets/pages/${pageId}/images/${hashImage(bytes, image.sourceUrl)}${extensionForImage(contentType, image.sourceUrl)}`;
  const localUrl = `/${objectKey}`;
  await putBinaryObject(objectKey, bytes, contentType);

  if (contentType === "image/svg+xml") {
    return {
      ...image,
      localUrl,
      objectKey,
      description: svgImageDescription(image.alt),
    };
  }

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

function appendImageDescriptions(
  markdown: string,
  images: StoredImage[],
  skippedImages: SkippedImage[],
): string {
  if (images.length === 0 && skippedImages.length === 0) return markdown;

  const storedLines = images.map((image, index) => [
    `### Image ${index + 1}: ${image.alt}`,
    `Local image: ${image.localUrl}`,
    `Original image: ${image.sourceUrl}`,
    `Codex image description: ${image.description}`,
  ].join("\n"));
  const skippedLines = skippedImages.map((image, index) => [
    `### Skipped image ${index + 1}: ${image.alt}`,
    `Reason: ${image.reason}`,
  ].join("\n"));

  return [
    markdown,
    "## Visual assets",
    ...storedLines,
    ...skippedLines,
  ].join("\n\n");
}

function removeImageMarkdown(
  markdown: string,
  image: SourceImage,
  replacement = `[Skipped image: ${image.alt}]`,
): string {
  const imagePattern = new RegExp(`!\\[[^\\]]*\\]\\(${escapeRegExp(image.sourceUrl)}\\)`, "g");
  return markdown.replace(imagePattern, replacement);
}

function imageSkipReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\bhttps?:\/\/[^\s)'"<>]+/gi, "[url redacted]");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function assertAllowedImageUrl(sourceUrl: string): Promise<void> {
  const url = new URL(sourceUrl);
  if (url.protocol !== "https:") {
    throw new Error("Image URL is not allowed.");
  }

  const host = normalizeUrlHostname(url.hostname);
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("Image URL is not allowed.");
  }

  if (isIpAddressBlocked(host)) {
    throw new Error("Image URL is not allowed.");
  }

  if (!isIP(host)) {
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (addresses.some((address) => isIpAddressBlocked(address.address))) {
      throw new Error("Image URL is not allowed.");
    }
  }
}

function normalizeUrlHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function isIpAddressBlocked(address: string): boolean {
  const normalizedAddress = normalizeIpAddress(address);
  const ipVersion = isIP(normalizedAddress);
  if (ipVersion === 4) {
    const [first, second] = normalizedAddress.split(".").map((part) => Number(part));
    return first === 0 ||
      first === 10 ||
      first === 127 ||
      first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 192 && second === 0) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 198 && second === 51) ||
      (first === 203 && second === 0);
  }

  if (ipVersion === 6) {
    const value = normalizedAddress.toLowerCase();
    return value === "::1" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      value.startsWith("fe8") ||
      value.startsWith("fe9") ||
      value.startsWith("fea") ||
      value.startsWith("feb");
  }

  return false;
}

function normalizeIpAddress(address: string): string {
  const mappedIpv4 = address.toLowerCase().match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedIpv4) return mappedIpv4[1];

  const mappedIpv4Hex = address.toLowerCase().match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedIpv4Hex) {
    const value = (Number.parseInt(mappedIpv4Hex[1], 16) << 16) + Number.parseInt(mappedIpv4Hex[2], 16);
    return [
      (value >>> 24) & 255,
      (value >>> 16) & 255,
      (value >>> 8) & 255,
      value & 255,
    ].join(".");
  }

  return address;
}

async function fetchImage(sourceUrl: string, redirectCount = 0): Promise<ImageFetchResponse> {
  await assertAllowedImageUrl(sourceUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), imageFetchTimeoutMs);
  try {
    const response = await undiciFetch(sourceUrl, {
      signal: controller.signal,
      redirect: "manual",
      dispatcher: safeImageDispatcher,
    } as Parameters<typeof undiciFetch>[1]);

    if (isRedirect(response.status)) {
      if (redirectCount >= maxImageRedirects) {
        throw new Error("Image redirect limit exceeded.");
      }

      const location = response.headers.get("location");
      if (!location) {
        throw new Error(`Image redirect missing location: ${sourceUrl}`);
      }

      return fetchImage(new URL(location, sourceUrl).toString(), redirectCount + 1);
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export function safeLookup(
  hostname: string,
  options: LookupOptions,
  callback: SafeLookupCallback,
): void {
  void lookup(hostname, { ...options, all: true, verbatim: true })
    .then((addresses) => {
      if (addresses.some((address) => isIpAddressBlocked(address.address))) {
        callback(new Error("Image URL is not allowed."), "", 0);
        return;
      }

      const first = addresses[0];
      if (!first) {
        callback(new Error("Image host did not resolve."), "", 0);
        return;
      }

      if (options.all) {
        callback(null, addresses.map(({ address, family }) => ({ address, family })));
        return;
      }

      callback(null, first.address, first.family);
    })
    .catch((error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), "", 0));
}

async function readImageBytes(response: ImageFetchResponse): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxImageBytes) {
    throw new Error("Image is too large.");
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > maxImageBytes) throw new Error("Image is too large.");
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxImageBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Image is too large.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return bytes;
}

function detectImageContentType(bytes: Uint8Array, contentType: string | null, sourceUrl: string): string {
  const value = contentType?.split(";")[0]?.trim().toLowerCase();
  const extension = extname(new URL(sourceUrl).pathname).toLowerCase();

  if (value === "image/svg+xml" || extension === ".svg") {
    if (looksLikeSvg(bytes)) return "image/svg+xml";
    throw new Error("Unsupported image type.");
  }

  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";

  throw new Error("Unsupported image type.");
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  const prefix = new TextDecoder("utf8", { fatal: false })
    .decode(bytes.slice(0, 2048))
    .replace(/^\uFEFF/, "")
    .trimStart();

  return /^(?:<\?xml\b[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)?(?:<!doctype\s+svg\b[^>]*>\s*)?<svg[\s>]/i.test(prefix);
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
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

function svgImageDescription(altText: string): string {
  const label = altText.trim();
  return label
    ? `SVG diagram from the Notion page labeled "${label}".`
    : "SVG diagram from the Notion page.";
}
