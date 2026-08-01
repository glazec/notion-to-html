import { type NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/server";

export default async function proxy(request: NextRequest) {
  if (!request.nextUrl.searchParams.has("neon_auth_session_verifier")) {
    return NextResponse.next();
  }

  const auth = await getAuth();
  return auth.middleware()(request);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|favicon.svg).*)"],
};
