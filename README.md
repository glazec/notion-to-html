# Notion to HTML

Railway hosted service that turns a Notion page link into served HTML.

## Architecture

```text
Railway Web API with /api/inngest
Railway Postgres
Railway Bucket
Inngest Cloud
Codex CLI with CODEX_ACCESS_TOKEN for remote document JSON generation
```

Generation flow:

```text
Notion markdown
-> Codex document-to-html JSON
-> deterministic HTML body renderer
-> Railway Bucket artifact
-> Railway API shell and toolbar
```

The stored artifact is the generated HTML body. The Railway API wraps that body
with the page shell and injects the toolbar at serve time.

## Environment

Copy `.env.example` and set:

```text
DATABASE_URL
BUCKET
ENDPOINT
REGION
ACCESS_KEY_ID
SECRET_ACCESS_KEY
NOTION_API_KEY
INNGEST_EVENT_KEY
INNGEST_SIGNING_KEY
CODEX_ACCESS_TOKEN or CODEX_AUTH_JSON_BASE64
```

`CODEX_ACCESS_TOKEN` is preferred for `codex exec` noninteractive generation. If
you cannot create a Codex access token, set `CODEX_AUTH_JSON_BASE64` to a base64
encoded Codex `auth.json`. The app writes that value to a temporary `CODEX_HOME`
only while a generation job is running. If no Codex credential is configured,
local development falls back to a deterministic markdown to document JSON
converter.

## Development

```bash
npm install
npm run dev
```

Use `LOCAL_BUCKET_DIR=.data/bucket` to test storage without Railway Bucket
credentials.

## Verification

```bash
npm run verify
```
