import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageRecord } from "@/lib/db";

const send = vi.fn();
const getCurrentVersion = vi.fn();
const setPageGenerationProgress = vi.fn();
const buildServedHtml = vi.fn();

vi.mock("@/inngest/client", () => ({
  events: { generatePage: "page/generate" },
  inngest: { send },
}));

vi.mock("@/lib/page-store", () => ({
  getCurrentVersion,
  setPageGenerationProgress,
}));

vi.mock("@/lib/generation", () => ({
  buildServedHtml,
}));

function page(overrides: Partial<PageRecord> = {}): PageRecord {
  const now = new Date();
  return {
    page_key: "37cf0ada243c81",
    slug: "1Money-6-11-2026-EN",
    notion_page_id: "37cf0ada-243c-8127-9b43-e3a1603c6a43",
    notion_url: "https://app.notion.com/p/iosgvc/1Money-6-11-2026-EN-37cf0ada243c81279b43e3a1603c6a43",
    current_hash: "hash",
    status: "ready",
    dirty_at: null,
    last_generated_at: now,
    generation_step: "Ready",
    generation_progress: 100,
    generation_log: [],
    user_transformed_at: now,
    last_error: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("served page response", () => {
  beforeEach(() => {
    send.mockReset();
    getCurrentVersion.mockReset();
    setPageGenerationProgress.mockReset();
    buildServedHtml.mockReset();
    getCurrentVersion.mockResolvedValue({
      object_key: "pages/1/index.html",
      document_json: { title: "1Money" },
      generated_at: new Date(),
    });
    buildServedHtml.mockResolvedValue("<html>cached</html>");
  });

  it("does not enqueue another generation while a cached page refresh is still within the long Codex window", async () => {
    const { servedPageResponse } = await import("@/lib/page-response");
    const response = await servedPageResponse(
      page({
        status: "generating",
        generation_step: "Rendering HTML",
        generation_progress: 75,
        updated_at: new Date(Date.now() - 8 * 60 * 1000),
      }),
      "https://notion-to-html-production.up.railway.app/p/37cf0ada243c81",
    );

    expect(response.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
    expect(setPageGenerationProgress).not.toHaveBeenCalled();
  });

  it("does not regenerate dirty pages before the Notion edit idle window", async () => {
    const { servedPageResponse } = await import("@/lib/page-response");
    const response = await servedPageResponse(
      page({
        status: "queued",
        dirty_at: new Date(Date.now() - 2 * 60 * 1000),
        updated_at: new Date(Date.now() - 2 * 60 * 1000),
      }),
      "https://notion-to-html-production.up.railway.app/p/37cf0ada243c81",
    );

    expect(response.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
    expect(setPageGenerationProgress).not.toHaveBeenCalled();
  });

  it("recovers cached dirty pages after the Notion edit idle window", async () => {
    setPageGenerationProgress.mockResolvedValue(page({
      status: "generating",
      generation_step: "Waiting for generator",
      generation_progress: 5,
    }));

    const { servedPageResponse } = await import("@/lib/page-response");
    const response = await servedPageResponse(
      page({
        status: "queued",
        dirty_at: new Date(Date.now() - 21 * 60 * 1000),
        updated_at: new Date(Date.now() - 21 * 60 * 1000),
      }),
      "https://notion-to-html-production.up.railway.app/p/37cf0ada243c81",
    );

    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      name: "page/generate",
      data: expect.objectContaining({ pageKey: "37cf0ada243c81" }),
    }));
    expect(setPageGenerationProgress).toHaveBeenCalledWith(expect.objectContaining({
      pageKey: "37cf0ada243c81",
      status: "generating",
      step: "Waiting for generator",
    }));
  });

  it("serves HTML with a restrictive content security policy", async () => {
    const { htmlResponse } = await import("@/lib/page-response");
    const response = htmlResponse("<main>ok</main>");
    const csp = response.headers.get("content-security-policy") ?? "";

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
