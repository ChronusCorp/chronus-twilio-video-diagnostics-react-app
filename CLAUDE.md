# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context

Chronus' self-hosted fork of the Twilio Video Diagnostics tool. The app is a stepwise wizard that tests a participant's ability to have a quality Twilio Video call: device permissions, camera/mic/speaker, browser support, Twilio cloud connectivity (preflight + bitrate), and downloadable results. Built on `@twilio/rtc-diagnostics` and `twilio-video`.

**Active rebrand:** Twilio → Chronus branding (favicon, page title, sidebar logos already removed; see recent commits on `task_rebrand_video_diagnostics_tool`).

**Deployment target:** AWS — CloudFront fronts an S3 bucket (static React build) and an API Gateway + Lambda (token + TURN credentials). Twilio Serverless is the legacy path (see [Legacy](#legacy-twilio-serverless-path) below). See `DEPLOYMENT.md` for the full architecture.

## Common commands

| Task | Command |
|---|---|
| Run app locally (token server + CRA dev server concurrently on :3000) | `npm start` |
| Run only the local token server (port 8083) | `npm run server` |
| Production build (outputs to `build/`) | `npm run build` |
| Build the Lambda deployment zip | `npm run lambda:build` |
| Run all frontend/server Jest tests | `npm test` |
| Run a single test file | `npx jest path/to/file.test.ts` |
| Filter tests by name | `npx jest -t "test name fragment"` |
| Lint | `npm run lint` |
| CI suite (app + serverless) | `npm run test:ci` |
| Lambda smoke test on Node 22 (matches runtime) | `nvm run 22 lambda/test-local.js` |

CRA proxies `/app/*` to `http://localhost:8083` via the `proxy` field in `package.json`, so the React app calls the same relative URLs in dev and prod.

## Architecture

### Frontend state machine (`src/components/AppStateProvider/AppStateProvider.tsx`)

A single context provider drives the whole app via `useReducer` + `immer`. Read this file first — most behavior radiates from it.

- `ActivePane` enum defines the linear pane order: `GetStarted → DeviceCheck → (DeviceError) → CameraTest → AudioTest → BrowserTest → Connectivity → Quality → Results`.
- `appStateReducer` handles all transitions. `next-pane` / `previous-pane` actions encode conditional skips (e.g., skip `DeviceCheck` when permissions are already granted; jump to `DeviceError` on permission failure). Adding a new pane usually means: extend `ActivePane`, add a transition case here, and add an entry to the `content` array in `MainContent.tsx`.
- Three async test hooks are wired in by the provider: `usePreflightTest` (Twilio video preflight), `useBitrateTest` (media bitrate test), `useTwilioStatus` (Twilio status API). They are kicked off when the user advances from `GetStarted`.
- `downloadFinalTestResults` assembles a JSON report from the various report slices in state.
- `isDownButtonDisabled` is the single source of truth for whether the user can advance — when adding new error/loading conditions, update this function rather than gating the button in `MainContent`.

### Pane rendering (`src/components/MainContent/MainContent.tsx`)

All panes render at once in a tall vertical scroll container that's transformed by `translateY` to center the active pane in the viewport. Inactive panes are dimmed and clickable to jump back to. The `hideAll` / `hideAfter` / `isHidden` flags suppress panes that don't apply to the current state (e.g., `DeviceError` is hidden unless a device error was raised).

### Backend (two implementations, same endpoints)

Both expose `GET /app/token` and `GET /app/turn-credentials`:

- **Production:** `lambda/handler.js` — packaged via `npm run lambda:build` into `lambda-deployment.zip` (handler + `twilio` SDK only, ~4.7MB). Reads `event.rawPath` (HTTP API v2) / `event.path` (v1). Honors `SERVICE_UNAVAILABLE=true` to return 503. Token TTL is 60s (video) / 30s (TURN) — short by design, since the client fetches fresh credentials each test run.
- **Local dev:** `server/index.ts` (Express) — `createExpressHandler` adapts the legacy Twilio Serverless functions in `serverless/functions/app/*.js` to Express. Same envelope shape so the React app sees identical responses.

When changing the API surface, update **both** `lambda/handler.js` and the corresponding `serverless/functions/app/*.js` file (until the legacy path is removed).

### Required env vars (Lambda + local)

`ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`. Optional: `VIDEO_IDENTITY` (default `RTC_Video_Diagnostics_Test_Identity`), `SERVICE_UNAVAILABLE`. Lambda values are configured on the function; local values come from `.env` (see `.env.example`).

## Tooling notes

- **Node:** v22 to match the Lambda runtime (`nodejs22.x`); v16+ works for the frontend build alone.
- **TypeScript:** 4.3, strict mode via CRA defaults. Server has its own `server/tsconfig.json`.
- **Tests:** Jest + Enzyme (with `enzyme-to-json` snapshot serializer) + React Testing Library. `jest.config.js` covers `src/` and `server/`; `jest.serverless.config.js` covers `serverless/`. Tests run in `jsdom`.
- **Lint/format:** ESLint with `react-app` + `react-app/jest` configs; Prettier (120 col, single quotes, ES5 trailing commas). Husky `pre-commit` runs `lint-staged` on staged files.
- **State management:** `immer` (drafts) inside `useReducer`. Mutate the `draft` directly in reducer cases — don't return a new object.
- **UI library:** Material-UI v4 (`@material-ui/core`/`@material-ui/icons`) with a custom theme in `src/theme.ts` that extends `Theme` with `navHeight`, `backgroundColor`, and `includeLandscapeMd` (a media-query string for landscape-orientation breakpoints used throughout responsive styling).

## Commit conventions

Do not append a `Co-Authored-By: Claude` (or any "Generated with Claude Code") trailer to commit messages or PR bodies.

## Legacy: Twilio Serverless path

The `serverless/` directory, `serverless:deploy` / `serverless:remove` / `serverless:list` npm scripts, `@twilio-labs/serverless-api` dependency, `jest.serverless.config.js`, and `test:serverless` / `test:ci:serverless` are the old Twilio-hosted deployment path. They still exist because the local Express dev server (`server/index.ts`) imports the serverless handler files via `createExpressHandler`. Removing the legacy path requires either inlining those handlers into `server/index.ts` or pointing the local server at `lambda/handler.js` directly.


## Personal Instructions

User-specific project instructions are in `CLAUDE.personal.md`. If the file exists, read and follow it.