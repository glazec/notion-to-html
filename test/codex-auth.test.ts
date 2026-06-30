import { describe, expect, it, vi } from "vitest";
import { generateDocumentJson, getCodexAuthJson } from "@/lib/codex-generator";

const authJson = {
  auth_mode: "chatgpt",
  OPENAI_API_KEY: null,
  tokens: {
    id_token: "id",
    access_token: "access",
    refresh_token: "refresh",
    account_id: "account",
  },
  last_refresh: "2026-06-30T00:00:00.000Z",
};

describe("Codex auth json", () => {
  it("normalizes raw auth json with trailing shell text", () => {
    vi.stubEnv("CODEX_AUTH_JSON", `${JSON.stringify(authJson)}%`);
    vi.stubEnv("CODEX_AUTH_JSON_BASE64", "");

    expect(JSON.parse(getCodexAuthJson() ?? "{}")).toMatchObject({
      auth_mode: "chatgpt",
      tokens: {
        access_token: "access",
      },
    });

    vi.unstubAllEnvs();
  });

  it("accepts base64 auth json", () => {
    vi.stubEnv("CODEX_AUTH_JSON", "");
    vi.stubEnv("CODEX_AUTH_JSON_BASE64", Buffer.from(JSON.stringify(authJson)).toString("base64"));

    expect(JSON.parse(getCodexAuthJson() ?? "{}").tokens.refresh_token).toBe("refresh");

    vi.unstubAllEnvs();
  });

  it("falls back to deterministic markdown when the codex binary is missing", async () => {
    vi.stubEnv("CODEX_ACCESS_TOKEN", "token");
    vi.stubEnv("CODEX_BIN", "missing-codex-binary");

    const document = await generateDocumentJson({
      notionUrl: "https://notion.so/test",
      markdown: "# Fallback title\n\nFallback body",
    });

    expect(document.title).toBe("Fallback title");
    expect(document.sections[1].blocks?.[1].text).toBe("Fallback body");

    vi.unstubAllEnvs();
  });
});
