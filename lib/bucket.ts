import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { optionalEnv, requireEnv } from "@/lib/env";

let s3: S3Client | undefined;

function bucketName(): string | undefined {
  return optionalEnv("BUCKET") ?? optionalEnv("AWS_S3_BUCKET_NAME") ?? optionalEnv("BUCKET_NAME");
}

function endpoint(): string | undefined {
  return optionalEnv("ENDPOINT") ?? optionalEnv("AWS_ENDPOINT_URL") ?? optionalEnv("BUCKET_ENDPOINT");
}

function region(): string {
  return optionalEnv("REGION") ?? optionalEnv("AWS_DEFAULT_REGION") ?? "auto";
}

function accessKeyId(): string | undefined {
  return optionalEnv("ACCESS_KEY_ID") ?? optionalEnv("AWS_ACCESS_KEY_ID") ?? optionalEnv("BUCKET_ACCESS_KEY_ID");
}

function secretAccessKey(): string | undefined {
  return optionalEnv("SECRET_ACCESS_KEY") ?? optionalEnv("AWS_SECRET_ACCESS_KEY") ?? optionalEnv("BUCKET_SECRET_ACCESS_KEY");
}

function useLocalBucket(): boolean {
  return !bucketName() || optionalEnv("LOCAL_BUCKET_DIR") !== undefined;
}

function getS3(): S3Client {
  if (!s3) {
    const key = accessKeyId();
    const secret = secretAccessKey();

    if (!key || !secret) {
      throw new Error("Missing Railway Bucket credentials.");
    }

    s3 = new S3Client({
      region: region(),
      endpoint: endpoint(),
      forcePathStyle: false,
      credentials: {
        accessKeyId: key,
        secretAccessKey: secret,
      },
    });
  }

  return s3;
}

export async function putHtmlObject(key: string, html: string): Promise<void> {
  if (useLocalBucket()) {
    await putLocalObject(key, html);
    return;
  }

  await getS3().send(
    new PutObjectCommand({
      Bucket: bucketName() ?? requireEnv("BUCKET"),
      Key: key,
      Body: html,
      ContentType: "text/html; charset=utf-8",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

export async function getHtmlObject(key: string): Promise<string> {
  if (useLocalBucket()) {
    return getLocalObject(key);
  }

  const result = await getS3().send(
    new GetObjectCommand({
      Bucket: bucketName() ?? requireEnv("BUCKET"),
      Key: key,
    }),
  );

  if (!result.Body) {
    throw new Error(`Bucket object has no body: ${key}`);
  }

  return result.Body.transformToString();
}

async function putLocalObject(key: string, html: string): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const path = await localPath(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, html, "utf8");
}

async function getLocalObject(key: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(await localPath(key), "utf8");
}

async function localPath(key: string): Promise<string> {
  const { join } = await import("node:path");
  const baseDir =
    optionalEnv("LOCAL_BUCKET_DIR") ??
    join(/* turbopackIgnore: true */ process.cwd(), ".data", "bucket");
  return join(baseDir, safeObjectKey(key));
}

function safeObjectKey(key: string): string {
  if (key.includes("..") || key.startsWith("/") || key.startsWith("\\")) {
    throw new Error(`Unsafe bucket object key: ${key}`);
  }

  return key;
}
