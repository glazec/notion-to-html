# Notion to HTML

Railway hosted service that turns a Notion page link into served HTML.

## Architecture

```text
Railway Web API with /api/inngest
Railway Postgres
Railway Bucket
Inngest Cloud
Codex CLI through the Inevitable AI Gateway for remote document generation
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
AI_GATEWAY_API_KEY
```

`AI_GATEWAY_API_KEY` runs Codex through the configured Responses API gateway and
does not depend on ChatGPT OAuth refresh tokens. `CODEX_ACCESS_TOKEN` and
`CODEX_AUTH_JSON_BASE64` remain supported as legacy local fallbacks. If no Codex
credential is configured, local development falls back to a deterministic
markdown to document JSON converter.

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
