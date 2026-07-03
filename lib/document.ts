import { z } from "zod";

export const documentBlockSchema = z.object({
  type: z.enum(["paragraph", "heading", "list_item", "quote", "code", "image", "table"]),
  text: z.string().optional(),
  level: z.number().int().min(1).max(3).optional(),
  url: z.string().url().optional(),
  alt: z.string().optional(),
  rows: z.array(z.array(z.string())).optional(),
});

export const documentSectionSchema = z.object({
  type: z.enum(["hero", "content"]),
  heading: z.string().optional(),
  body: z.string().optional(),
  blocks: z.array(documentBlockSchema).optional(),
});

export const documentHtmlJsonSchema = z.object({
  schema_version: z.literal(1),
  title: z.string(),
  notionUrl: z.string(),
  theme: z.literal("light"),
  sections: z.array(documentSectionSchema).min(1),
});

export type DocumentHtmlJson = z.infer<typeof documentHtmlJsonSchema>;
export type DocumentBlock = z.infer<typeof documentBlockSchema>;

export function documentFromMarkdown(input: {
  markdown: string;
  notionUrl: string;
}): DocumentHtmlJson {
  const lines = input.markdown.split(/\r?\n/);
  const firstHeading = lines.find((line) => /^#\s+/.test(line));
  const title = firstHeading?.replace(/^#\s+/, "").trim() || "Untitled Notion Page";
  const blocks: DocumentBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (isShellNoise(line)) continue;

    const codeFence = line.match(/^```[A-Za-z0-9_-]*\s*$/);
    if (codeFence) {
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }

      blocks.push({ type: "code", text: codeLines.join("\n").trim() });
      continue;
    }

    if (isTableRow(line) && isTableSeparator(lines[index + 1]?.trim() ?? "")) {
      const tableRows: string[][] = [splitTableRow(line)];
      index += 2;

      while (index < lines.length && isTableRow(lines[index].trim())) {
        tableRows.push(splitTableRow(lines[index].trim()));
        index += 1;
      }

      index -= 1;

      if (tableRows.length > 0) {
        blocks.push({ type: "table", rows: tableRows });
      }
      continue;
    }

    const image = line.match(/^!\[([^\]]*)\]\(((?:https?:\/\/|\/assets\/)[^)\s]+)\)$/);
    if (image) {
      blocks.push({
        type: "image",
        text: image[1].trim() || "Image",
        alt: image[1].trim() || "Image",
        url: image[2],
      });
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        text: heading[2].trim(),
      });
      continue;
    }

    const listItem = line.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      blocks.push({ type: "list_item", text: listItem[1].trim() });
      continue;
    }

    if (line.startsWith(">")) {
      blocks.push({ type: "quote", text: line.replace(/^>\s?/, "").trim() });
      continue;
    }

    blocks.push({ type: "paragraph", text: line });
  }

  return {
    schema_version: 1,
    title,
    notionUrl: input.notionUrl,
    theme: "light",
    sections: [
      {
        type: "hero",
        heading: title,
        body: blocks.find((block) => block.type === "paragraph")?.text ?? "Generated from Notion.",
      },
      {
        type: "content",
        blocks,
      },
    ],
  };
}

function isShellNoise(line: string): boolean {
  return /^\[?Skip to content\]?\(/i.test(line) || /^Skip to content$/i.test(line);
}

function isTableRow(line: string): boolean {
  return line.startsWith("|") && line.endsWith("|");
}

function isTableSeparator(line: string): boolean {
  return /^\|?(\s*:?-{3,}:?\s*\|)+\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function parseDocumentJson(value: unknown): DocumentHtmlJson {
  return documentHtmlJsonSchema.parse(value);
}
