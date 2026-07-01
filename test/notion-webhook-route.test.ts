import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findPage = vi.fn();
const markPageDirty = vi.fn();
const send = vi.fn();

vi.mock("@/lib/page-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/page-store")>()),
  findPage,
  markPageDirty,
}));

vi.mock("@/inngest/client", () => ({
  events: { pageDirty: "page/dirty" },
  inngest: { send },
}));

describe("Notion webhook route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    findPage.mockReset();
    markPageDirty.mockReset();
    send.mockReset();
  });

  it("echoes the Notion verification token without mutating pages", async () => {
    const { POST } = await import("@/app/api/notion/webhook/route");
    const response = await POST(new Request("https://app.test/api/notion/webhook", {
      method: "POST",
      body: JSON.stringify({ verification_token: "secret_verify" }),
    }));

    await expect(response.json()).resolves.toEqual({ verification_token: "secret_verify" });
    expect(markPageDirty).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects unsigned webhook events before marking pages dirty", async () => {
    const { POST } = await import("@/app/api/notion/webhook/route");
    const response = await POST(new Request("https://app.test/api/notion/webhook", {
      method: "POST",
      body: eventBody(),
    }));

    expect(response.status).toBe(503);
    expect(findPage).not.toHaveBeenCalled();
    expect(markPageDirty).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects events with an invalid Notion signature", async () => {
    vi.stubEnv("NOTION_WEBHOOK_VERIFICATION_TOKEN", "secret_verify");

    const { POST } = await import("@/app/api/notion/webhook/route");
    const response = await POST(new Request("https://app.test/api/notion/webhook", {
      method: "POST",
      headers: { "x-notion-signature": "sha256=bad" },
      body: eventBody(),
    }));

    expect(response.status).toBe(401);
    expect(markPageDirty).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("marks tracked pages dirty only when the Notion signature is valid", async () => {
    vi.stubEnv("NOTION_WEBHOOK_VERIFICATION_TOKEN", "secret_verify");
    findPage.mockResolvedValueOnce({ page_key: "35cf0ada243c80" });
    markPageDirty.mockResolvedValueOnce({ page_key: "35cf0ada243c80" });

    const rawBody = eventBody();
    const { POST } = await import("@/app/api/notion/webhook/route");
    const response = await POST(new Request("https://app.test/api/notion/webhook", {
      method: "POST",
      headers: { "x-notion-signature": notionSignature(rawBody, "secret_verify") },
      body: rawBody,
    }));

    expect(response.status).toBe(200);
    expect(markPageDirty).toHaveBeenCalledWith("35cf0ada243c80", expect.any(Date));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      name: "page/dirty",
      data: expect.objectContaining({ pageKey: "35cf0ada243c80" }),
    }));
  });
});

function eventBody(): string {
  return JSON.stringify({
    type: "page.content_updated",
    entity: {
      id: "35cf0ada-243c-808a-bb24-deca7fe22fab",
      type: "page",
    },
  });
}

function notionSignature(rawBody: string, token: string): string {
  return `sha256=${createHmac("sha256", token).update(rawBody).digest("hex")}`;
}
