export function isMissingEnvError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Missing required environment variable:");
}

export function missingConfigResponse(error: unknown): Response {
  return Response.json(
    {
      error: error instanceof Error ? error.message : "Missing required configuration.",
    },
    { status: 503 },
  );
}
