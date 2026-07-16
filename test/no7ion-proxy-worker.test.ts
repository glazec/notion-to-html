import { afterEach, describe, expect, it, vi } from "vitest";

describe("no7ion Cloudflare proxy worker", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("routes app.no7ion.com Notion paths through the existing pasted URL flow", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);

      expect(_url).toBe(
        "https://notion-to-html-production.up.railway.app/https:/app.notion.com/p/iosgvc/Computation-Financialization-Sourcing-38bf0ada243c80c0b59ccb6d3dd4ab0d",
      );
      expect(headers.get("x-forwarded-host")).toBe("app.no7ion.com");
      expect(headers.get("x-forwarded-proto")).toBe("https");

      return new Response(null, {
        status: 303,
        headers: {
          location: "https://notion-to-html-production.up.railway.app/Computation-Financialization-Sourcing",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    // @ts-expect-error Worker source is plain JavaScript for direct Cloudflare upload.
    const worker = (await import("../cloudflare/no7ion-proxy-worker.js")).default;
    const response = await worker.fetch(
      new Request("https://app.no7ion.com/p/iosgvc/Computation-Financialization-Sourcing-38bf0ada243c80c0b59ccb6d3dd4ab0d"),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://no7ion.com/Computation-Financialization-Sourcing");
  });

  it("routes workspace.no7ion.com paths through the matching public Notion site", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);

      expect(_url).toBe(
        "https://notion-to-html-production.up.railway.app/https:/iosgvc.notion.site/Potential-Skills-Consolidation-396f0ada243c80869444d8f311c7a296?source=copy_link",
      );
      expect(headers.get("x-forwarded-host")).toBe("iosgvc.no7ion.com");
      expect(headers.get("x-forwarded-proto")).toBe("https");

      return new Response(null, {
        status: 303,
        headers: {
          location: "https://notion-to-html-production.up.railway.app/Potential-Skills-Consolidation",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    // @ts-expect-error Worker source is plain JavaScript for direct Cloudflare upload.
    const worker = (await import("../cloudflare/no7ion-proxy-worker.js")).default;
    const response = await worker.fetch(
      new Request(
        "https://iosgvc.no7ion.com/Potential-Skills-Consolidation-396f0ada243c80869444d8f311c7a296?source=copy_link",
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://no7ion.com/Potential-Skills-Consolidation");
  });

  it("proxies no7ion.com paths to the Railway origin", async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(url));
    vi.stubGlobal("fetch", fetchMock);

    // @ts-expect-error Worker source is plain JavaScript for direct Cloudflare upload.
    const worker = (await import("../cloudflare/no7ion-proxy-worker.js")).default;
    const response = await worker.fetch(new Request("https://no7ion.com/api/pages?notionUrl=test"));

    expect(await response.text()).toBe("https://notion-to-html-production.up.railway.app/api/pages?notionUrl=test");
  });
});
