import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const authMiddleware = vi.fn();
const getAuth = vi.fn(async () => ({ middleware: () => authMiddleware }));

vi.mock("@/lib/auth/server", () => ({ getAuth }));

describe("Neon Auth proxy", () => {
  beforeEach(() => {
    authMiddleware.mockReset();
    getAuth.mockClear();
  });

  it("leaves ordinary public requests unprotected", async () => {
    const { default: proxy } = await import("../proxy");
    const response = await proxy(new NextRequest("https://example.com/"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(getAuth).not.toHaveBeenCalled();
  });

  it("exchanges an OAuth verifier returned on the landing page", async () => {
    const expected = NextResponse.redirect("https://example.com/");
    authMiddleware.mockResolvedValue(expected);
    const request = new NextRequest("https://example.com/?neon_auth_session_verifier=test-verifier");
    const { default: proxy } = await import("../proxy");

    const response = await proxy(request);

    expect(getAuth).toHaveBeenCalledOnce();
    expect(authMiddleware).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });
});
