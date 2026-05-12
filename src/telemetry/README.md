# src/telemetry

Posts diagnostic step results to the Rails ingest API as each step completes.

## When it runs

Mounted once inside `AppStateProvider`. Reads `?t=<token>` from the URL on
mount; in demo mode (no/invalid token) the module is a no-op and the user
sees normal diagnostic behaviour.

## What it sends

One POST per step, body shape:

```json
{
  "diagnostics_page_loaded_at": "2026-05-12T14:23:11.234Z",
  "results": { "camera": { "ok": true } }
}
```

The `results` object accumulates client-side and every POST carries any
un-ACKed deltas, so a transient failure self-heals via the server's
`deep_merge`.

## Transport

`fetch(..., { keepalive: true })` only. On `visibilitychange→hidden` or
`pagehide`, any un-ACKed buffer is flushed once with `keepalive: true` so
the browser can complete delivery as the tab unloads.

## Failure handling

- 5xx → 3 retries, 250 ms / 500 ms / 1 s backoff, then drop (data stays in
  the cumulative buffer and rides the next step's POST).
- 4xx → disable for the rest of the session.
- Anything thrown is caught, logged via `console.warn` in dev, and silently
  dropped in prod.

## Public surface

- `useTelemetry(state, userAgent)` — the only entry point a caller should
  need.
- `createTelemetryClient` / `parseToken` — exported for unit testing and
  unusual integrations. Not part of the typical wiring path.

## Debugging

Add a `console.warn` breakpoint on `[telemetry]` log lines. There is no UI
overlay — use DevTools' Network tab to inspect POSTs.
