import { formatNotionId, parseNotionPageId } from "@/lib/notion";

export type PublicNotionDatabaseRow = {
  id: string;
  compactId: string;
  title: string;
  description: string;
  productUrl: string;
  category: string;
  createdTime: number | null;
  rowUrl: string;
};

export type PublicNotionDatabase = {
  pageId: string;
  sourceUrl: string;
  collectionId: string;
  viewId: string;
  title: string;
  rows: PublicNotionDatabaseRow[];
  schema: Record<string, NotionSchemaProperty>;
};

type NotionSchemaProperty = {
  name?: string;
  type?: string;
  options?: unknown[];
};

type NotionRecord<T> = {
  role?: string;
  value?: T | {
    role?: string;
    value?: T;
    spaceId?: string;
  };
  spaceId?: string;
};

type NotionBlock = {
  id?: string;
  type?: string;
  properties?: Record<string, unknown>;
  collection_id?: string;
  view_ids?: string[];
  created_time?: number;
  space_id?: string;
};

type NotionCollection = {
  id?: string;
  name?: unknown;
  schema?: Record<string, NotionSchemaProperty>;
};

type NotionRecordMap = {
  block?: Record<string, NotionRecord<NotionBlock>>;
  collection?: Record<string, NotionRecord<NotionCollection>>;
  collection_view?: Record<string, NotionRecord<{ id?: string; type?: string; space_id?: string }>>;
};

type LoadPageChunkResponse = {
  recordMap?: NotionRecordMap;
};

type QueryCollectionResponse = {
  result?: {
    reducerResults?: Record<string, unknown>;
  };
  reducerResults?: Record<string, unknown>;
  recordMap?: NotionRecordMap;
};

const notionApiBase = "https://www.notion.so/api/v3";
const rowLimit = 1000;

export async function fetchPublicNotionDatabase(notionUrl: string): Promise<PublicNotionDatabase | null> {
  const pageId = parseNotionPageId(notionUrl);
  const load = await postNotionApi<LoadPageChunkResponse>("loadPageChunk", {
    pageId,
    limit: 100,
    cursor: { stack: [] },
    chunkNumber: 0,
    verticalColumns: false,
  });

  const pageRecord = load.recordMap?.block?.[pageId];
  const pageBlock = recordValue(pageRecord);
  if (!pageRecord || !pageBlock || pageBlock.type !== "collection_view_page") {
    return null;
  }

  const collectionId = pageBlock.collection_id ?? firstRecordId(load.recordMap?.collection);
  const viewId = selectViewId(notionUrl, pageBlock.view_ids ?? [], load.recordMap?.collection_view);
  const spaceId = recordSpaceId(pageRecord, pageBlock);
  if (!collectionId || !viewId || !spaceId) {
    return null;
  }

  const collection = recordValue(load.recordMap?.collection?.[collectionId]);
  const schema = collection?.schema ?? {};
  const query = await postNotionApi<QueryCollectionResponse>("queryCollection", {
    collection: { id: collectionId, spaceId },
    collectionView: { id: viewId, spaceId },
    loader: {
      type: "reducer",
      reducers: {
        collection_group_results: {
          type: "results",
          limit: rowLimit,
          loadContentCover: true,
        },
      },
      searchQuery: "",
      userTimeZone: "America/New_York",
    },
    query: {
      aggregations: [{ property: "title", aggregator: "count" }],
      filter: [],
      sort: [],
    },
  });

  const recordMap = mergeRecordMaps(load.recordMap, query.recordMap);
  const blockIds = extractResultBlockIds(query);
  const propertyIds = databasePropertyIds(schema);
  const rows = blockIds
    .map((blockId) => recordMap.block?.[formatNotionId(blockId)] ?? recordMap.block?.[blockId])
    .map((record) => recordValue(record))
    .filter((block): block is NotionBlock => Boolean(block))
    .filter((block) => block.type === "page")
    .map((block) => rowFromBlock(block, propertyIds, notionUrl, viewId));

  return {
    pageId,
    sourceUrl: notionUrl,
    collectionId,
    viewId,
    title: richTextPlainText(pageBlock.properties?.title) || richTextPlainText(collection?.name) || "Notion database",
    rows,
    schema,
  };
}

function rowFromBlock(
  block: NotionBlock,
  propertyIds: ReturnType<typeof databasePropertyIds>,
  sourceUrl: string,
  viewId: string,
): PublicNotionDatabaseRow {
  const rowId = formatNotionId(block.id ?? "");
  const properties = block.properties ?? {};
  const title = richTextPlainText(properties[propertyIds.title]) || "Untitled";
  const description = propertyIds.description ? richTextPlainText(properties[propertyIds.description]) : "";
  const productUrl = propertyIds.url ? richTextPlainText(properties[propertyIds.url]) : "";
  const category = propertyIds.category ? richTextPlainText(properties[propertyIds.category]) : "";

  return {
    id: rowId,
    compactId: compactNotionId(rowId),
    title,
    description,
    productUrl,
    category: category || "uncategorized",
    createdTime: typeof block.created_time === "number" ? block.created_time : null,
    rowUrl: rowUrlFromDatabaseUrl(sourceUrl, viewId, rowId),
  };
}

function databasePropertyIds(schema: Record<string, NotionSchemaProperty>): {
  title: string;
  description: string | null;
  url: string | null;
  category: string | null;
} {
  return {
    title: propertyIdByType(schema, "title") ?? "title",
    description: propertyIdByName(schema, ["description", "desc"]) ?? propertyIdByType(schema, "text"),
    url: propertyIdByName(schema, ["url", "website", "link"]) ?? propertyIdByType(schema, "url"),
    category: propertyIdByName(schema, ["category", "type", "tag", "tags"]) ??
      propertyIdByType(schema, "select") ??
      propertyIdByType(schema, "multi_select"),
  };
}

function propertyIdByName(schema: Record<string, NotionSchemaProperty>, names: string[]): string | null {
  const nameSet = new Set(names.map((name) => name.toLowerCase()));
  for (const [id, property] of Object.entries(schema)) {
    const name = property.name?.trim().toLowerCase();
    if (name && nameSet.has(name)) return id;
  }
  return null;
}

function propertyIdByType(schema: Record<string, NotionSchemaProperty>, type: string): string | null {
  for (const [id, property] of Object.entries(schema)) {
    if (property.type === type) return id;
  }
  return null;
}

function selectViewId(
  notionUrl: string,
  viewIds: string[],
  collectionViews: NotionRecordMap["collection_view"],
): string | null {
  const normalizedViewIds = viewIds.map(formatNotionId);
  try {
    const requested = new URL(notionUrl).searchParams.get("v");
    if (requested) {
      const requestedId = formatNotionId(requested);
      if (normalizedViewIds.includes(requestedId)) return requestedId;
    }
  } catch {
    // Use the first public view below.
  }

  return normalizedViewIds[0] ?? firstRecordId(collectionViews);
}

function firstRecordId<T>(records: Record<string, NotionRecord<T>> | undefined): string | null {
  const id = Object.keys(records ?? {})[0];
  return id ? formatNotionId(id) : null;
}

function recordValue<T>(record: NotionRecord<T> | undefined): T | undefined {
  const rawValue = record?.value;
  if (isRecord(rawValue) && "value" in rawValue) {
    return rawValue.value as T | undefined;
  }
  return rawValue as T | undefined;
}

function recordSpaceId(record: NotionRecord<NotionBlock>, value: NotionBlock): string | undefined {
  if (record.spaceId) return record.spaceId;
  const rawValue = isRecord(record.value) ? record.value as Record<string, unknown> : null;
  if (typeof rawValue?.spaceId === "string") return rawValue.spaceId;
  return value.space_id;
}

function extractResultBlockIds(query: QueryCollectionResponse): string[] {
  const reducers = query.result?.reducerResults ?? query.reducerResults ?? {};
  const collectionResults = reducers.collection_group_results;
  if (!isRecord(collectionResults)) return [];

  const blockIds = collectionResults.blockIds;
  if (!Array.isArray(blockIds)) return [];

  return blockIds
    .filter((blockId): blockId is string => typeof blockId === "string")
    .map(formatNotionId);
}

function mergeRecordMaps(first: NotionRecordMap | undefined, second: NotionRecordMap | undefined): NotionRecordMap {
  return {
    block: { ...(first?.block ?? {}), ...(second?.block ?? {}) },
    collection: { ...(first?.collection ?? {}), ...(second?.collection ?? {}) },
    collection_view: { ...(first?.collection_view ?? {}), ...(second?.collection_view ?? {}) },
  };
}

function rowUrlFromDatabaseUrl(sourceUrl: string, viewId: string, rowId: string): string {
  const url = new URL(sourceUrl);
  url.searchParams.set("v", compactNotionId(viewId));
  url.searchParams.set("p", compactNotionId(rowId));
  url.searchParams.set("pm", "s");
  return url.toString();
}

function richTextPlainText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";

  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!Array.isArray(part)) return "";
      if (typeof part[0] === "string") return part[0];
      return richTextPlainText(part[0]);
    })
    .join("")
    .trim();
}

function compactNotionId(id: string): string {
  return formatNotionId(id).replaceAll("-", "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function postNotionApi<T>(endpoint: string, body: unknown): Promise<T> {
  const response = await fetch(`${notionApiBase}/${endpoint}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "notion-client-version": "23.13.0.95",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`Public Notion ${endpoint} failed: ${response.status} ${responseBody}`);
  }

  return response.json() as Promise<T>;
}
