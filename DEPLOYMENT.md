# AWS CloudFront + Lambda + S3 Deployment

## Architecture

```
                        Browser
                           │
                           ▼
                   ┌───────────────┐
                   │  CloudFront   │
                   └───┬───────┬───┘
            /app/*  ◄──┘       └──►  /* (everything else)
                │                       │
                ▼                       ▼
         ┌─────────────┐         ┌─────────────┐
         │ API Gateway │         │     S3      │
         │ (HTTP API)  │         │  (Static)   │
         └──────┬──────┘         └─────────────┘
                │
                ▼
         ┌─────────────┐
         │   Lambda    │
         │  (handler)  │
         └─────────────┘
```

- **CloudFront** is the single public origin. It routes by path:
  - `/app/*` → API Gateway → Lambda (`/app/token`, `/app/turn-credentials`)
  - everything else → S3 static React build
- **S3** holds the React build artifacts (`npm run build` output).
- **API Gateway + Lambda** serves the two backend endpoints.

## Architecture Decisions

### Same-origin via CloudFront path routing

The React app makes axios calls to relative URLs (`/app/token`, `/app/turn-credentials`). Because CloudFront fronts both origins, the browser sees one hostname and the requests are same-origin. CloudFront's path-pattern behavior forwards `/app/*` to the API Gateway origin and everything else to the S3 origin — no runtime config injection, no CORS gymnastics, no rebuild needed to repoint backends.

### S3 origin for SPA routing

Configure the S3 origin (or CloudFront's default behavior) so that missing keys fall back to `index.html`. The simplest approach is a CloudFront Function or a custom error response that rewrites 403/404 to `/index.html` with a 200, which preserves client-side routing.

### CORS

Same-origin from the browser's perspective means CORS preflight isn't required for normal calls. The Lambda handler still returns `Access-Control-Allow-Origin: *` defensively, which is harmless. You do **not** need to configure API Gateway CORS for the CloudFront-fronted flow.

### Lambda packaging

The Lambda zip is built separately from the frontend. It contains only `handler.js`, `package.json`, and `node_modules/` (just the `twilio` SDK). This keeps the zip small (~4.7MB) and decoupled from the React build.

## Configuration

### Lambda environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ACCOUNT_SID` | Yes | Twilio Account SID |
| `TWILIO_API_KEY_SID` | Yes | Twilio API Key SID |
| `TWILIO_API_KEY_SECRET` | Yes | Twilio API Key Secret |
| `VIDEO_IDENTITY` | No | Identity for video token (default: `RTC_Video_Diagnostics_Test_Identity`) |
| `SERVICE_UNAVAILABLE` | No | Set to `true` to return 503 on all API requests |

### CloudFront behaviors

| Path pattern | Origin | Notes |
|--------------|--------|-------|
| `/app/*` | API Gateway | Forward all headers/methods; disable caching (or cache with `Authorization` in the cache key if you add auth). |
| `*` (default) | S3 | Cache aggressively. Map 403/404 → `/index.html` (200) for SPA routing. |

### API Gateway route

The route `ANY /app/{proxy+}` passes the full path (e.g., `/app/token`) to Lambda. The handler reads `event.rawPath` (v2) or `event.path` (v1) to determine which endpoint was called.

### Local dev

CRA's dev server uses the `"proxy": "http://localhost:8083/"` field in `package.json` to forward relative `/app/*` requests to the local Express server (started alongside the dev server via `npm start`). No config switch needed — the same relative URLs work in dev and in production.

## Build Commands

### Frontend

```bash
npm run build
```

Produces `build/` with the React static assets.

### Lambda

```bash
npm run lambda:build
```

Produces `lambda-deployment.zip` containing `handler.js`, `package.json`, and `node_modules/`.

### Lambda local tests

```bash
nvm run 22 lambda/test-local.js
```

The Lambda function runs on the `nodejs22.x` runtime in AWS; use Node 22 locally to keep parity.

## Updating

### Frontend only

```bash
npm run build
aws s3 sync build/ s3://$BUCKET_NAME/ --delete
aws cloudfront create-invalidation --distribution-id $CF_DIST_ID --paths "/*"
```

Invalidates cached static assets at the edge. `/*` covers everything; `/app/*` is included but is a no-op when that behavior is configured uncached (see [CloudFront behaviors](#cloudfront-behaviors)).

### Backend only

```bash
npm run lambda:build
aws lambda update-function-code \
  --function-name twilio-video-diagnostics \
  --zip-file fileb://lambda-deployment.zip
```

No CloudFront invalidation needed *assuming* `/app/*` is configured uncached (see [CloudFront behaviors](#cloudfront-behaviors)). If you cache `/app/*`, also invalidate `/app/*` after backend updates.
