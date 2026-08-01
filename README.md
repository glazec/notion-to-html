# Notion to HTML

Public service that turns a Notion page link into served HTML.

## Architecture

```text
Next.js Web API with /api/inngest
Neon Postgres and Managed Better Auth
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

Google OAuth is handled by Neon Managed Better Auth. A regular account can
claim two new sites per UTC day. Claiming the same source again does not spend
another credit. Accounts with an email ending in exactly `@iosg.vc` have
unlimited site creation. The reservation, page upsert, and user ownership row
are committed in one Postgres transaction.

The stored artifact is the generated HTML body. The Railway API wraps that body
with the page shell and injects the toolbar at serve time.

## Environment

Copy `.env.example` and set:

```text
DATABASE_URL
NEON_AUTH_BASE_URL
NEON_AUTH_COOKIE_SECRET
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

Enable Managed Better Auth for the Neon branch, configure Google as the only
social provider, and add the deployed app origin to trusted domains. In Google
Cloud, the authorized redirect URI is
`{NEON_AUTH_BASE_URL}/callback/google`. The application URL is the OAuth
`callbackURL`, not the provider redirect URI.

`AI_GATEWAY_API_KEY` runs Codex through the configured Responses API gateway and
does not depend on ChatGPT OAuth refresh tokens. `CODEX_ACCESS_TOKEN` and
`CODEX_AUTH_JSON_BASE64` remain supported as legacy local fallbacks. If no Codex
credential is configured, local development falls back to a deterministic
markdown to document JSON converter.

Full page and document generation use GPT 5.6 Terra with medium reasoning.
Image descriptions use GPT 5.6 Terra with low reasoning because they are narrow,
factual tasks. This split keeps the stronger semantic HTML result on pages while
reducing latency and tokens on each source image.

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
