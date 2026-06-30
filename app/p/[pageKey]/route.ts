import { findPage } from "@/lib/page-store";
import { isMissingEnvError, missingConfigResponse } from "@/lib/http-errors";
import { servedPageResponse } from "@/lib/page-response";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ pageKey: string }> },
) {
  const { pageKey } = await context.params;
  let page;

  try {
    page = await findPage(pageKey);
  } catch (error) {
    if (isMissingEnvError(error)) {
      return missingConfigResponse(error);
    }
    throw error;
  }

  if (!page) {
    return new Response("Page not found", { status: 404 });
  }

  return servedPageResponse(page, request.url);
}
