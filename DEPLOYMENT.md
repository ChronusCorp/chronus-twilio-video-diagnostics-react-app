# AWS Lambda + S3 Deployment

## Architecture

```
          Browser
         /      \
        /        \
       ▼          ▼
┌─────────────┐  ┌─────────────┐
│     S3      │  │ API Gateway  │
│  (Static)   │  │  (HTTP API)  │
└─────────────┘  └──────┬───────┘
                        │
                        ▼
                 ┌─────────────┐
                 │   Lambda     │
                 │  (handler)   │
                 └─────────────┘
```

- **S3** serves the static React build via S3 website hosting
- **API Gateway + Lambda** handles `/app/token` and `/app/turn-credentials`
- **No CloudFront** — the frontend reads the API Gateway URL from `runtime-config.js` and makes direct cross-origin requests, eliminating the need for CloudFront's two-origin routing

## Architecture Decisions

### Runtime config instead of CloudFront

The app has 3 axios calls that hit `/app/token` and `/app/turn-credentials`. Previously these were relative URLs, requiring CloudFront to unify S3 and API Gateway under one domain. Instead, `public/runtime-config.js` sets `window.__RUNTIME_CONFIG__.TOKEN_SERVER_URL` which the axios calls read at runtime. This means:

- S3 and API Gateway can live on separate domains
- The API URL can be changed post-build by editing one file in S3
- No CloudFront distribution to configure or pay for

### S3 website hosting for SPA routing

Use S3's static website hosting with `--error-document index.html`. This serves `index.html` for missing paths, handling client-side routing. Use the website endpoint (`BUCKET.s3-website-REGION.amazonaws.com`), not the REST endpoint which returns XML errors for missing keys.

### CORS

Since the browser makes cross-origin requests (S3 domain → API Gateway domain), CORS is required. The Lambda handler already returns `Access-Control-Allow-Origin: *` on every response. Configure API Gateway's built-in CORS support as well to handle OPTIONS preflight at the gateway level.

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

### Runtime config (`build/runtime-config.js`)

```js
window.__RUNTIME_CONFIG__ = {
  TOKEN_SERVER_URL: "https://YOUR_API_ID.execute-api.REGION.amazonaws.com",
};
```

- **Local dev**: Leave `TOKEN_SERVER_URL` as `""`. Relative URLs hit the CRA proxy → Express on `:8083`.
- **AWS**: Set to your API Gateway URL before uploading to S3.
- **Post-deploy**: Upload a new `runtime-config.js` to S3 — no rebuild needed.

### API Gateway route

The route `ANY /app/{proxy+}` passes the full path (e.g., `/app/token`) to Lambda. The handler reads `event.rawPath` (v2) or `event.path` (v1) to determine which endpoint was called.

## Build Commands

### Frontend

```bash
npm run build
```

Produces `build/` with React static assets + `runtime-config.js`.

### Lambda

```bash
npm run lambda:build
```

Produces `lambda-deployment.zip` containing `handler.js`, `package.json`, and `node_modules/`.

### Lambda local tests

```bash
nvm run 20 lambda/test-local.js
```

## Updating

### Frontend only

```bash
npm run build
aws s3 sync build/ s3://$BUCKET_NAME/ --delete
```

### Backend only

```bash
npm run lambda:build
aws lambda update-function-code \
  --function-name twilio-video-diagnostics \
  --zip-file fileb://lambda-deployment.zip
```

### Change API URL only (no rebuild)

```bash
aws s3 cp runtime-config.js s3://$BUCKET_NAME/runtime-config.js
```
