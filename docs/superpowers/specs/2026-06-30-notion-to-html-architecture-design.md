# Notion to HTML Architecture Design

## Goal

Build a Railway hosted service that turns a Notion page link into a served HTML page.

The product should return existing generated HTML immediately when it exists. If no generated HTML exists, it should start generation in the background and show an in flight page. When Notion changes, the service should wait until the page has been idle for 20 minutes, then regenerate.

Database links are not part of v1. They need a separate design because a database can mean a listing page, detail page templates, or both.

## V1 Stack

Use Railway as the main platform.

1. Railway Web API with `/api/inngest`
2. Railway background worker code inside the same service
3. Railway Postgres
4. Railway Bucket
5. Inngest Cloud
6. Codex CLI with `CODEX_ACCESS_TOKEN` for remote document JSON generation

Inngest Cloud orchestrates durable functions by calling the Railway app's `/api/inngest` endpoint. The generation code runs in the Railway app process as background function steps. Inngest handles delayed regeneration, retries, traces, and concurrency. Railway Postgres remains the source of truth. Railway Bucket stores generated HTML body artifacts.

If generation becomes CPU heavy or needs independent scaling, split the background code into a separate Railway service using Inngest Connect. That is not required for v1.

Do not use Redis in v1. Do not use Railway Sandbox in the default path. Do not store generated HTML in Git.

## Request Flow

```text
User opens /p/{page_key}
API resolves page_key in Postgres
API checks the current generated version
If ready, API fetches the HTML body artifact from Railway Bucket and wraps it
If missing, API sends an Inngest generation event
API returns an in flight page
```

## Generation Flow

```text
Inngest calls Railway /api/inngest
Railway generation step fetches Notion content
Railway generation step calls Codex with CODEX_ACCESS_TOKEN to build document to HTML JSON
Railway generation step renders final HTML body artifact
Railway generation step uploads HTML body artifact to Railway Bucket
Railway generation step updates Postgres current pointer
Railway generation step removes local temp files
```

The page is generated inside the Railway app service during Inngest function execution. Railway Bucket is only artifact storage.

## Regeneration Flow

```text
Notion webhook receives page update
API records dirty_at in Postgres
API sends a new Inngest delayed event containing dirty_at
Inngest waits 20 minutes
Railway generation step checks whether dirty_at is still unchanged
If unchanged, Railway generation step regenerates
If newer edit exists, Railway generation step exits
```

This keeps the 20 minute idle rule deterministic and avoids repeated generation while the user is actively editing.

## HTML Artifact Storage

Use immutable object keys:

```text
pages/{notion_page_id}/{content_hash}/index.html
```

Postgres stores the active pointer:

```text
page_key
notion_page_id
notion_url
current_hash
status
dirty_at
last_generated_at
last_error
```

Keep previous versions for rollback and debugging. A practical default is to retain the latest 10 versions per page or expire versions older than 30 days.

## Document To HTML JSON

The generator should produce a stable JSON document before rendering HTML. Raw HTML should be the final artifact, not the main generator output.

Example:

```json
{
  "schema_version": 1,
  "title": "Page title",
  "notionUrl": "https://notion.so/...",
  "theme": "light",
  "sections": [
    {
      "type": "hero",
      "heading": "Main heading",
      "body": "Short intro"
    },
    {
      "type": "content",
      "blocks": []
    }
  ]
}
```

This gives a testable boundary between Notion parsing, document shaping, and HTML rendering.

Codex is the primary generator when `CODEX_ACCESS_TOKEN` is configured. Local development can use a deterministic markdown to document JSON fallback when no token is present.

## Serving HTML

Serve HTML through the Railway API, backed by Railway Bucket.

The stored artifact is the generated HTML body, not the full served page. The API fetches the current body artifact from the bucket, wraps it in the app shell, injects the toolbar, and returns the full HTML response with:

```text
Content-Type: text/html; charset=utf-8
Cache-Control: public, max-age=300, stale-while-revalidate=86400
```

Do not redirect users to a bucket URL in v1. Railway Buckets are private and presigned URLs are not good canonical page URLs.

## Page Chrome

Wrap served HTML with a small Vercel inspired toolbar.

The toolbar has two icon buttons:

1. Open source Notion page
2. Regenerate page

No permission rule is required in v1. Add basic rate limits to protect generation cost:

```text
same page can regenerate once per 2 minutes
same IP has an hourly regeneration limit
```

The toolbar is injected at serve time by the Railway API. It is app chrome, not generated Notion content. This lets the product change controls without regenerating all stored pages.

## Sandbox Position

Do not use sandbox for the default renderer.

Use sandbox later only for cases that need isolated execution:

1. Codex layout polish
2. Browser screenshot validation
3. Arbitrary dependency installation
4. Untrusted generated code execution

The deterministic Notion to HTML renderer should run in the Railway app service as an Inngest function step.

## Open Questions

1. Exact public URL shape for page links
2. Whether users can customize slug values
3. Whether the toolbar should always be visible or collapsible by default
4. Retention policy for old HTML versions
5. V2 database behavior: listing page, detail page templates, or both
