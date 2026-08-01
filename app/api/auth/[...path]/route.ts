import { getAuth } from "@/lib/auth/server";

type AuthRouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, context: AuthRouteContext) {
  const auth = await getAuth();
  return auth.handler().GET(request, context);
}

export async function POST(request: Request, context: AuthRouteContext) {
  const auth = await getAuth();
  return auth.handler().POST(request, context);
}
