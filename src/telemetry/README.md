# src/telemetry

## What this module does

When a user runs through the video diagnostics — granting permissions, testing
their camera/mic/speaker, running preflight + bitrate checks — this module
POSTs the same data that would land in the "Download report results" JSON file
to a backend ingest endpoint, **incrementally as each test completes**, so the
backend has a live record of how the session is going without waiting for the
user to manually click download.

The endpoint is encoded in the `?t=<token>` URL parameter that the calling
application embeds when it links a user into the diagnostics page. The token
claim `endpoint` tells us where to POST; the claim `member_id` /
`meeting_id` / `organization_id` is included via the `Authorization: Bearer <token>` header so the backend can attribute the data to the right session.

## When it runs

Mounted once inside `AppStateProvider`. Reads `?t=<token>` from the URL on
mount; in demo mode (no/invalid token) the module is a no-op and the user
sees normal diagnostic behaviour.

## What it sends

One POST per step transition, body shape:

```json
{
  "diagnostics_page_loaded_at": "2026-05-12T14:23:11.234Z",
  "results": {
    "videoTestResults": { "errors": [], "deviceId": "cam-0" }
  }
}
```

The `results` shape mirrors the JSON produced by `downloadFinalTestResults`
in `AppStateProvider.tsx`. Each POST carries only the top-level sections that
**changed** since the last successful POST (diffed at the section level in
`useTelemetry.ts`); the backend deep-merges into the accumulated record for
`(member_id, meeting_id, diagnostics_page_loaded_at)`. Once the user reaches
the Results pane, a final POST with `completed: true` signals the session is
done.

Top-level sections (all optional in any given POST; required cumulatively for
a complete report):

| Key                   | Source state                                                 | Type                                        |
| --------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| `browserInformation`  | `userAgentInfo` from `UAParser`                              | `UAParser.IResult`                          |
| `videoTestResults`    | `state.videoInputTestReport`                                 | `VideoInputTest.Report`                     |
| `audioTestResults`    | `state.audioInputTestReport` + `state.audioOutputTestReport` | `{ inputTest, outputTest }`                 |
| `connectivityResults` | `state.twilioStatus`, signaling/turn reachability            | `{ twilioServices, signalingRegion, TURN }` |
| `preflightTestReport` | `state.preflightTest.report`, error, tokenError              | `{ report, error }`                         |
| `bitrateTestResults`  | `state.bitrateTest.report`                                   | `{ maxBitrate, ...rest }`                   |
| `completed`           | `state.activePane === Results`                               | `true` (only sent once at the end)          |

## Divergence from the downloaded JSON

For a fully-completed session (user reaches Results), the cumulative
backend-side `results` matches the downloaded `finalTestResults`
**byte-identical except for the items below**.

### 1. Wire-only extra: `completed: true`

The POST body carries `completed: true` in the final POST; the download JSON
has no such field. This is a wire-protocol signal for the backend to mark the
session as finalized.

### 2. Omitted fields (stripped from POST, kept in download)

Four fields are stripped from the wire to reduce payload size and remove
backend-useless data. The download keeps them for forensic debugging in the
browser. The strip contract is enforced at the type level via `Omit<>` on
`ResultsFragment` — touching one of these on a `ResultsFragment` value is a
compile error.

| Omitted from telemetry                         | Why                                                                                                   | Approx. saving                               |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `audioTestResults.inputTest.recordingUrl`      | A `blob:` URL — only resolvable in the browser context that created it; dead data on the backend      | ~50 bytes, but eliminates a misleading field |
| `audioTestResults.inputTest.values`            | Per-sample audio-level timeline (~100 numbers); only useful for in-browser volume meter visualization | ~0.5 KB                                      |
| `bitrateTestResults.iceCandidateStats`         | ICE candidate stats array — useful only for browser-level connectivity debugging                      | ~2–6 KB                                      |
| `preflightTestReport.report.iceCandidateStats` | Same shape as above, inside the preflight report                                                      | ~2–6 KB                                      |

Implementation: `stripAudioInputForWire` / `stripBitrateForWire` /
`stripPreflightForWire` in `buildResultsFragment.ts`. Total payload reduction
per session: ~50% (from ~10–15 KB → ~6–10 KB).

### 3. Section-presence divergence (incomplete sessions only)

The download JSON **always** emits all six top-level sections, even when their
underlying state is `null` (e.g., `videoTestResults: null` when the camera
test hasn't run yet). The telemetry POSTs **conditionally** emit a section
only when its underlying state has data — sections that are still null get
omitted from the wire entirely.

In practice, when the user reaches the Results pane all sections have data,
so the cumulative POST `results` and the download JSON converge to the same
shape. The divergence only manifests if you compare:

- The cumulative POST state mid-session (some sections still missing), vs.
- A download taken at that same mid-session moment (all sections present, some null).

If the backend needs to distinguish "section absent because user hadn't
reached that step" from "section absent because of a delivery failure", look
for the `completed: true` field — its absence means the session didn't reach
Results.

### 4. `preflightTestReport.error` — _no_ divergence

The `error` field now carries Chronus-tagged token errors via the shared
helper `src/utils/formatPreflightError.ts` in **both** the download and the
telemetry POST. When `state.preflightTest.tokenError` is set without a
regular `state.preflightTest.error`, both artifacts emit
`"[chronus] preflight token error: <message>"`. Backends can detect this
case by prefix-matching `"[chronus]"`.

## Transport

`fetch(...)` for normal POSTs (no `keepalive`). On `visibilitychange→hidden`
or `pagehide`, any un-ACKed buffer is flushed once with `keepalive: true` so
the browser can complete delivery as the tab unloads.

## Failure handling

- 5xx → 3 attempts total (initial + 2 retries), with 250 ms then 500 ms
  backoff between attempts. After the third attempt fails, the data stays in
  the cumulative buffer and rides the next step's POST.
- 4xx → disable for the rest of the session.
- Anything thrown is caught, logged via `console.warn` in dev, and silently
  dropped in prod.

## Public surface

- `useTelemetry(state, userAgent)` — the only entry point a caller should
  need.
- `buildResultsFragment(state, userAgent)` — pure function that produces the
  intended fragment from current state; exported for testing.
- `createTelemetryClient` / `parseToken` — exported for unit testing and
  unusual integrations. Not part of the typical wiring path.

## Debugging

Add a `console.warn` breakpoint on `[telemetry]` log lines. There is no UI
overlay — use DevTools' Network tab to inspect POSTs.
