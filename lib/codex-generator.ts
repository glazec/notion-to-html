import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { documentFromMarkdown, parseDocumentJson, type DocumentHtmlJson } from "@/lib/document";
import { optionalEnv } from "@/lib/env";

const execFileAsync = promisify(execFile);

const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    schema_version: { type: "number", const: 1 },
    title: { type: "string" },
    notionUrl: { type: "string" },
    theme: { type: "string", const: "light" },
    sections: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { enum: ["hero", "content"] },
          heading: { type: "string" },
          body: { type: "string" },
          blocks: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                type: { enum: ["paragraph", "heading", "list_item", "quote", "code", "image", "table"] },
                text: { type: "string" },
                level: { type: "number" },
                url: { type: "string" },
                alt: { type: "string" },
                rows: {
                  type: "array",
                  items: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
              required: ["type"],
            },
          },
        },
        required: ["type"],
      },
    },
  },
  required: ["schema_version", "title", "notionUrl", "theme", "sections"],
};

export async function generateDocumentJson(input: {
  markdown: string;
  notionUrl: string;
}): Promise<DocumentHtmlJson> {
  if (shouldUseCodex()) {
    try {
      return await generateWithCodex(input);
    } catch (error) {
      if (!isMissingCodexBinaryError(error)) {
        throw error;
      }
    }
  }

  return documentFromMarkdown(input);
}

function isMissingCodexBinaryError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function shouldUseCodex(): boolean {
  if (optionalEnv("CODEX_GENERATION_ENABLED") === "false") return false;
  return Boolean(
    optionalEnv("CODEX_ACCESS_TOKEN") ||
      optionalEnv("CODEX_AUTH_JSON") ||
      optionalEnv("CODEX_AUTH_JSON_BASE64"),
  );
}

async function generateWithCodex(input: {
  markdown: string;
  notionUrl: string;
}): Promise<DocumentHtmlJson> {
  const dir = await mkdtemp(join(tmpdir(), "notion-to-html-codex-"));
  const markdownPath = join(dir, "notion.md");
  const schemaPath = join(dir, "schema.json");
  const outputPath = join(dir, "document.json");
  const codexBin = optionalEnv("CODEX_BIN") ?? "codex";
  const authEnv = await prepareCodexAuthEnv(dir);

  try {
    await writeFile(markdownPath, input.markdown, "utf8");
    await writeFile(schemaPath, JSON.stringify(outputSchema, null, 2), "utf8");

    const prompt = [
      "Convert notion.md into document-to-html JSON for a light theme HTML page.",
      "Use the source URL exactly:",
      input.notionUrl,
      "Keep the output factual. Do not invent claims that are not in the markdown.",
      "Use schema_version 1. Use sections with a hero and content blocks.",
      "Preserve markdown images as image blocks with url and alt.",
      "Preserve markdown tables as table blocks with rows, including the header as the first row.",
      "Return only schema-conforming JSON.",
    ].join("\n");

    await execFileAsync(
      codexBin,
      [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "--output-schema",
        schemaPath,
        "-o",
        outputPath,
        prompt,
      ],
      {
        cwd: dir,
        timeout: 180_000,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          ...authEnv,
        },
      },
    );

    const raw = await readFile(outputPath, "utf8");
    return parseDocumentJson(JSON.parse(raw));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function prepareCodexAuthEnv(workDir: string): Promise<Record<string, string>> {
  const accessToken = optionalEnv("CODEX_ACCESS_TOKEN");
  if (accessToken) {
    return { CODEX_ACCESS_TOKEN: accessToken };
  }

  const authJson = getCodexAuthJson();
  if (!authJson) {
    return {};
  }

  const codexHome = join(workDir, "codex-home");
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await writeFile(join(codexHome, "auth.json"), authJson, { encoding: "utf8", mode: 0o600 });

  return { CODEX_HOME: codexHome };
}

export function getCodexAuthJson(): string | null {
  const base64 = optionalEnv("CODEX_AUTH_JSON_BASE64");
  const raw = base64
    ? Buffer.from(base64, "base64").toString("utf8")
    : optionalEnv("CODEX_AUTH_JSON");

  if (!raw) {
    return null;
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("CODEX_AUTH_JSON does not contain a JSON object.");
  }

  const json = raw.slice(start, end + 1);
  const parsed = JSON.parse(json) as {
    auth_mode?: string;
    tokens?: unknown;
  };

  if (parsed.auth_mode !== "chatgpt" || typeof parsed.tokens !== "object" || !parsed.tokens) {
    throw new Error("CODEX_AUTH_JSON is not a valid ChatGPT Codex auth file.");
  }

  return `${JSON.stringify(parsed)}\n`;
}
