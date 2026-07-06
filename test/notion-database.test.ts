import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPublicNotionDatabase } from "@/lib/notion-database";

const pageId = "11111111-1111-1111-1111-111111111111";
const collectionId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const viewId = "22222222-2222-2222-2222-222222222222";
const spaceId = "space-1";
const rowOneId = "33333333-3333-3333-3333-333333333333";
const rowTwoId = "44444444-4444-4444-4444-444444444444";

describe("public Notion database fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches rows from the public collection view API", async () => {
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input);

      if (url.endsWith("/loadPageChunk")) {
        return jsonResponse({
          recordMap: {
            block: {
              [pageId]: {
                spaceId,
                value: {
                  role: "reader",
                  value: {
                    id: pageId,
                    type: "collection_view_page",
                    collection_id: collectionId,
                    view_ids: [viewId],
                    properties: { title: [["Toolbox"]] },
                  },
                },
              },
            },
            collection: {
              [collectionId]: {
                value: {
                  role: "reader",
                  value: {
                    id: collectionId,
                    name: [["Toolbox"]],
                    schema: {
                      title: { name: "Name", type: "title" },
                      desc: { name: "Description", type: "text" },
                      url: { name: "URL", type: "url" },
                      cat: { name: "Category", type: "select" },
                    },
                  },
                },
              },
            },
            collection_view: {
              [viewId]: { value: { id: viewId, type: "table" } },
            },
          },
        });
      }

      if (url.endsWith("/queryCollection")) {
        const body = JSON.parse(String(init?.body));
        expect(body.collection).toEqual({ id: collectionId, spaceId });
        expect(body.collectionView).toEqual({ id: viewId, spaceId });
        expect(body.loader.reducers.collection_group_results.limit).toBe(1000);

        return jsonResponse({
          result: {
            reducerResults: {
              collection_group_results: {
                blockIds: [rowOneId, rowTwoId],
              },
            },
          },
          recordMap: {
            block: {
              [rowOneId]: rowRecord(rowOneId, "Alpha", "Docs at [site](https://alpha.example/docs)", "https://alpha.example", "ai", 1760000000000),
              [rowTwoId]: rowRecord(rowTwoId, "Beta", "**Bold** description", "beta.example/path", "web", 1760100000000),
            },
          },
        });
      }

      return new Response("unexpected", { status: 404 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const database = await fetchPublicNotionDatabase(
      `https://app.notion.com/p/workspace/Toolbox-${pageId.replaceAll("-", "")}?v=${viewId.replaceAll("-", "")}`,
    );

    expect(database?.title).toBe("Toolbox");
    expect(database?.rows).toHaveLength(2);
    expect(database?.rows[0]).toMatchObject({
      id: rowOneId,
      compactId: rowOneId.replaceAll("-", ""),
      title: "Alpha",
      description: "Docs at [site](https://alpha.example/docs)",
      productUrl: "https://alpha.example",
      category: "ai",
      createdTime: 1760000000000,
    });

    const rowUrl = new URL(database?.rows[0].rowUrl ?? "");
    expect(rowUrl.searchParams.get("v")).toBe(viewId.replaceAll("-", ""));
    expect(rowUrl.searchParams.get("p")).toBe(rowOneId.replaceAll("-", ""));
    expect(rowUrl.searchParams.get("pm")).toBe("s");
  });

  it("returns null when the public page is not a collection view page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      recordMap: {
        block: {
          [pageId]: {
            spaceId,
            value: {
              id: pageId,
              type: "page",
              properties: { title: [["Regular page"]] },
            },
          },
        },
      },
    })));

    await expect(fetchPublicNotionDatabase(
      `https://app.notion.com/p/workspace/Page-${pageId.replaceAll("-", "")}`,
    )).resolves.toBeNull();
  });
});

function rowRecord(
  id: string,
  title: string,
  description: string,
  url: string,
  category: string,
  createdTime: number,
) {
  return {
    value: {
      role: "reader",
      value: {
        id,
        type: "page",
        created_time: createdTime,
        properties: {
          title: [[title]],
          desc: [[description]],
          url: [[url, [["a", url]]]],
          cat: [[category]],
        },
      },
    },
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
