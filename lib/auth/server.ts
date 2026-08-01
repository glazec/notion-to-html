import type { NeonAuth } from "@neondatabase/auth/next/server";
import { requireEnv } from "@/lib/env";

let authInstance: Promise<NeonAuth> | undefined;

export async function getAuth(): Promise<NeonAuth> {
  authInstance ??= import("@neondatabase/auth/next/server").then(({ createNeonAuth }) => createNeonAuth({
      baseUrl: requireEnv("NEON_AUTH_BASE_URL"),
      cookies: {
        secret: requireEnv("NEON_AUTH_COOKIE_SECRET"),
        sameSite: "lax",
      },
    }));

  return authInstance;
}

export async function getCurrentUser() {
  const auth = await getAuth();
  const { data: session } = await auth.getSession();
  return session?.user ?? null;
}
