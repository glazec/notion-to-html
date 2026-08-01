import type { NextRequest } from "next/server";
import { getAuth } from "@/lib/auth/server";

export default async function proxy(request: NextRequest) {
  const auth = await getAuth();
  return auth.middleware()(request);
}

export const config = {
  matcher: ["/auth/callback"],
};
