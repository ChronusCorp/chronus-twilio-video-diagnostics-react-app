# Video Diagnostics Telemetry — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up telemetry so each completed diagnostic step is POSTed to the Rails ingest API as it happens, with a best-effort `fetch(keepalive: true)` flush on tab close.

**Architecture:** A single `useTelemetry(state)` hook is added inside `AppStateProvider`. It (1) parses the `?t=` token on mount and falls into demo or post mode; (2) watches the reducer's state slices and pushes step-finish events through a small `telemetryClient`; (3) the client maintains an in-memory cumulative buffer, retries on 5xx with exponential backoff, and flushes via `fetch(..., {keepalive: true})` on `visibilitychange→hidden` / `pagehide`. Failures are swallowed; nothing about telemetry can break the diagnostic flow.

**Tech Stack:** TypeScript, React 17, Jest 27, `@testing-library/react-hooks`, native `fetch` / `URLSearchParams` / `atob`. No new dependencies.

**Decisions baked in:**
- No "run started" empty POST (first POST is the first real step result).
- PII passthrough — no redaction.
- No CloudFront CSP change required.
- No debug overlay — console logs only (dev-stripped in prod).
- `fetch(keepalive: true)` is the single transport; no `sendBeacon` fallback.
- Token in `Authorization: Bearer <t>` on every request, including unload.

---

## File Structure

```
src/telemetry/
  types.ts                 ★ shared types (token, results shape, client surface)
  parseToken.ts            ★ URL → {mode: 'post' | 'demo'} pure function
  parseToken.test.ts
  stepExtractors.ts        ★ state slice → results-fragment pure functions
  stepExtractors.test.ts
  telemetryClient.ts       ★ queue + fetch + retry + keepalive flush
  telemetryClient.test.ts
  useTelemetry.ts          ★ React hook; watches state, drives the client
  useTelemetry.test.tsx
  index.ts                 ★ barrel
  README.md                ★ short module README (architecture, debugging)

src/components/AppStateProvider/AppStateProvider.tsx
  modify: 3-line addition — useTelemetry(state) call after the existing useReducer
```

Each file is ≤150 lines. The split is by responsibility: parsing, schema-mapping, transport, integration.

---

## Task 1: `parseToken` — URL token parser

**Files:**
- Create: `src/telemetry/parseToken.ts`
- Create: `src/telemetry/parseToken.test.ts`
- Create: `src/telemetry/types.ts`

- [ ] **Step 1.1: Create `types.ts` with the token + mode types**

```ts
// src/telemetry/types.ts

export interface TokenClaims {
  v: number;
  endpoint: string;
  organization_id: number;
  member_id: number;
  meeting_id: number;
  exp: number;
}

export type TelemetryMode =
  | { mode: 'post'; endpoint: string; rawToken: string; claims: TokenClaims }
  | { mode: 'demo'; reason: 'no-token' | 'malformed' | 'missing-claim' | 'expired-locally' };

export interface ResultsFragment {
  browser?: { ok: boolean; name?: string; version?: string };
  permissions?: { ok: boolean; denied?: string[] };
  camera?: { ok: boolean; device?: string; error?: string };
  microphone?: { ok: boolean; input_level_db?: number; error?: string };
  speaker?: { ok: boolean; error?: string };
  network?: {
    ok: boolean;
    signaling_reachable?: boolean;
    turn_reachable?: boolean;
    rtt_ms?: number;
    jitter_ms?: number;
  };
  twilio_services?: Record<string, string>;
  bitrate?: { ok: boolean; max_kbps?: number; average_kbps?: number; error?: string };
  completed?: boolean;
  quality_score?: string;
}
```

- [ ] **Step 1.2: Write the failing tests for `parseToken`**

```ts
// src/telemetry/parseToken.test.ts

import { parseToken } from './parseToken';

function buildToken(claims: object): string {
  const payload = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${payload}.sig`;
}

const validClaims = {
  v: 1,
  endpoint: 'https://mentoreu.chronus.com/video_call_diagnostic_runs',
  organization_id: 42,
  member_id: 12345,
  meeting_id: 98765,
  exp: Math.floor(Date.now() / 1000) + 3600,
};

describe('parseToken', () => {
  it('returns post mode for a fully valid token', () => {
    const result = parseToken(`?t=${buildToken(validClaims)}`);
    expect(result.mode).toBe('post');
    if (result.mode === 'post') {
      expect(result.endpoint).toBe(validClaims.endpoint);
      expect(result.claims.member_id).toBe(12345);
    }
  });

  it('returns demo mode when t param is absent', () => {
    expect(parseToken('')).toEqual({ mode: 'demo', reason: 'no-token' });
    expect(parseToken('?other=1')).toEqual({ mode: 'demo', reason: 'no-token' });
  });

  it('returns demo mode for malformed base64', () => {
    expect(parseToken('?t=!!!.sig')).toEqual({ mode: 'demo', reason: 'malformed' });
  });

  it('returns demo mode when token is not two segments', () => {
    expect(parseToken('?t=onlyonesegment')).toEqual({ mode: 'demo', reason: 'malformed' });
  });

  it.each(['endpoint', 'organization_id', 'member_id', 'meeting_id'] as const)(
    'returns demo mode when %s claim is missing',
    (claim) => {
      const { [claim]: _omit, ...rest } = validClaims;
      const result = parseToken(`?t=${buildToken(rest)}`);
      expect(result).toEqual({ mode: 'demo', reason: 'missing-claim' });
    }
  );

  it('returns demo mode when endpoint is not https', () => {
    const result = parseToken(`?t=${buildToken({ ...validClaims, endpoint: 'http://insecure.test/x' })}`);
    expect(result).toEqual({ mode: 'demo', reason: 'missing-claim' });
  });

  it('returns demo mode when exp is in the past', () => {
    const result = parseToken(`?t=${buildToken({ ...validClaims, exp: 1 })}`);
    expect(result).toEqual({ mode: 'demo', reason: 'expired-locally' });
  });
});
```

- [ ] **Step 1.3: Run tests to verify they fail**

Run: `npx jest src/telemetry/parseToken.test.ts`
Expected: FAIL — "Cannot find module './parseToken'"

- [ ] **Step 1.4: Implement `parseToken.ts`**

```ts
// src/telemetry/parseToken.ts

import type { TelemetryMode, TokenClaims } from './types';

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return atob(padded + '='.repeat(padLen));
}

function isValidClaims(c: unknown): c is TokenClaims {
  if (typeof c !== 'object' || c === null) return false;
  const o = c as Record<string, unknown>;
  return (
    typeof o.endpoint === 'string' &&
    o.endpoint.startsWith('https://') &&
    typeof o.organization_id === 'number' &&
    typeof o.member_id === 'number' &&
    typeof o.meeting_id === 'number'
  );
}

export function parseToken(search: string): TelemetryMode {
  const params = new URLSearchParams(search);
  const raw = params.get('t');
  if (!raw) return { mode: 'demo', reason: 'no-token' };

  const parts = raw.split('.');
  if (parts.length !== 2) return { mode: 'demo', reason: 'malformed' };

  let claims: unknown;
  try {
    claims = JSON.parse(base64UrlDecode(parts[0]));
  } catch {
    return { mode: 'demo', reason: 'malformed' };
  }

  if (!isValidClaims(claims)) return { mode: 'demo', reason: 'missing-claim' };

  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) {
    return { mode: 'demo', reason: 'expired-locally' };
  }

  return { mode: 'post', endpoint: claims.endpoint, rawToken: raw, claims };
}
```

- [ ] **Step 1.5: Run tests to verify they pass**

Run: `npx jest src/telemetry/parseToken.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 1.6: Commit**

```bash
git add src/telemetry/types.ts src/telemetry/parseToken.ts src/telemetry/parseToken.test.ts
git commit -m "AP-43454 feat(telemetry): add parseToken for video diagnostics URL token"
```

---

## Task 2: `stepExtractors` — state slice → results-fragment

**Files:**
- Create: `src/telemetry/stepExtractors.ts`
- Create: `src/telemetry/stepExtractors.test.ts`

- [ ] **Step 2.1: Write failing tests**

```ts
// src/telemetry/stepExtractors.test.ts

import {
  extractBrowser,
  extractPermissions,
  extractCamera,
  extractMicrophone,
  extractSpeaker,
  extractNetwork,
  extractTwilioServices,
  extractBitrate,
} from './stepExtractors';

describe('stepExtractors', () => {
  describe('extractBrowser', () => {
    it('returns ok=true when browser info is present', () => {
      const ua = { browser: { name: 'Chrome', version: '126' } } as any;
      expect(extractBrowser(ua)).toEqual({ browser: { ok: true, name: 'Chrome', version: '126' } });
    });
    it('returns ok=false when browser is unknown', () => {
      const ua = { browser: {} } as any;
      expect(extractBrowser(ua)).toEqual({ browser: { ok: false } });
    });
  });

  describe('extractPermissions', () => {
    it('returns ok=true when both granted', () => {
      expect(extractPermissions(true, true)).toEqual({ permissions: { ok: true } });
    });
    it('returns ok=false with denied list when audio is denied', () => {
      expect(extractPermissions(false, true)).toEqual({ permissions: { ok: false, denied: ['microphone'] } });
    });
    it('returns both denied when neither granted', () => {
      expect(extractPermissions(false, false)).toEqual({
        permissions: { ok: false, denied: ['microphone', 'camera'] },
      });
    });
  });

  describe('extractCamera', () => {
    it('returns ok=true with device label on success', () => {
      const report = { errors: [], deviceId: '', deviceName: 'FaceTime HD' } as any;
      expect(extractCamera(report)).toEqual({ camera: { ok: true, device: 'FaceTime HD' } });
    });
    it('returns ok=false with error on failure', () => {
      const report = { errors: [{ name: 'NotReadableError', message: 'in use' }], deviceName: 'FaceTime HD' } as any;
      expect(extractCamera(report)).toEqual({ camera: { ok: false, device: 'FaceTime HD', error: 'NotReadableError' } });
    });
  });

  describe('extractMicrophone', () => {
    it('returns ok=true with input level on success', () => {
      const report = { errors: [], values: [-30, -20, -10] } as any;
      expect(extractMicrophone(report)).toEqual({ microphone: { ok: true, input_level_db: -10 } });
    });
    it('returns ok=false with error on failure', () => {
      const report = { errors: [{ name: 'NotAllowedError' }], values: [] } as any;
      expect(extractMicrophone(report)).toEqual({ microphone: { ok: false, error: 'NotAllowedError' } });
    });
  });

  describe('extractSpeaker', () => {
    it('returns ok=true on success', () => {
      expect(extractSpeaker({ errors: [] } as any)).toEqual({ speaker: { ok: true } });
    });
    it('returns ok=false with error on failure', () => {
      expect(extractSpeaker({ errors: [{ name: 'DeviceError' }] } as any)).toEqual({
        speaker: { ok: false, error: 'DeviceError' },
      });
    });
  });

  describe('extractNetwork', () => {
    it('returns ok=true with rtt and jitter from preflight report', () => {
      const report = {
        stats: { rtt: { average: 42 }, jitter: { average: 6 } },
      } as any;
      const out = extractNetwork(report, true, true);
      expect(out.network!.ok).toBe(true);
      expect(out.network!.rtt_ms).toBe(42);
      expect(out.network!.jitter_ms).toBe(6);
      expect(out.network!.signaling_reachable).toBe(true);
      expect(out.network!.turn_reachable).toBe(true);
    });
    it('returns ok=false if signaling unreachable', () => {
      expect(extractNetwork(null, false, false)).toEqual({
        network: { ok: false, signaling_reachable: false, turn_reachable: false },
      });
    });
  });

  describe('extractTwilioServices', () => {
    it('returns the twilio_services map', () => {
      const status = { 'Group Rooms': 'operational' } as any;
      expect(extractTwilioServices(status)).toEqual({ twilio_services: { 'Group Rooms': 'operational' } });
    });
  });

  describe('extractBitrate', () => {
    it('returns ok=true with max from values array', () => {
      const report = { values: [800, 1200, 1180], averageBitrate: 1060, errors: [] } as any;
      expect(extractBitrate(report)).toEqual({
        bitrate: { ok: true, max_kbps: 1200, average_kbps: 1060 },
      });
    });
    it('returns ok=false with error on failure', () => {
      expect(extractBitrate(null, new Error('TURN unreachable'))).toEqual({
        bitrate: { ok: false, error: 'TURN unreachable' },
      });
    });
  });
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `npx jest src/telemetry/stepExtractors.test.ts`
Expected: FAIL — "Cannot find module './stepExtractors'"

- [ ] **Step 2.3: Implement `stepExtractors.ts`**

```ts
// src/telemetry/stepExtractors.ts

import type { ResultsFragment } from './types';
import type UAParser from 'ua-parser-js';
import type { PreflightTestReport } from 'twilio-video';
import type {
  AudioInputTest,
  AudioOutputTest,
  MediaConnectionBitrateTest,
  VideoInputTest,
} from '@twilio/rtc-diagnostics';
import type { TwilioStatus } from '../components/AppStateProvider/AppStateProvider';

export function extractBrowser(ua: UAParser.IResult): ResultsFragment {
  const name = ua.browser?.name;
  const version = ua.browser?.version;
  if (!name) return { browser: { ok: false } };
  return { browser: { ok: true, name, ...(version && { version }) } };
}

export function extractPermissions(audioGranted: boolean, videoGranted: boolean): ResultsFragment {
  if (audioGranted && videoGranted) return { permissions: { ok: true } };
  const denied: string[] = [];
  if (!audioGranted) denied.push('microphone');
  if (!videoGranted) denied.push('camera');
  return { permissions: { ok: false, denied } };
}

export function extractCamera(report: VideoInputTest.Report): ResultsFragment {
  const device = (report as any).deviceName as string | undefined;
  if (report.errors && report.errors.length > 0) {
    return { camera: { ok: false, ...(device && { device }), error: report.errors[0].name } };
  }
  return { camera: { ok: true, ...(device && { device }) } };
}

export function extractMicrophone(report: AudioInputTest.Report): ResultsFragment {
  if (report.errors && report.errors.length > 0) {
    return { microphone: { ok: false, error: report.errors[0].name } };
  }
  const max = report.values && report.values.length > 0 ? Math.max(...report.values) : undefined;
  return { microphone: { ok: true, ...(max !== undefined && { input_level_db: max }) } };
}

export function extractSpeaker(report: AudioOutputTest.Report): ResultsFragment {
  if (report.errors && report.errors.length > 0) {
    return { speaker: { ok: false, error: report.errors[0].name } };
  }
  return { speaker: { ok: true } };
}

export function extractNetwork(
  report: PreflightTestReport | null,
  signalingReachable: boolean,
  turnReachable: boolean
): ResultsFragment {
  if (!signalingReachable) {
    return { network: { ok: false, signaling_reachable: false, turn_reachable: turnReachable } };
  }
  const rtt = report?.stats?.rtt?.average;
  const jitter = report?.stats?.jitter?.average;
  return {
    network: {
      ok: true,
      signaling_reachable: true,
      turn_reachable: turnReachable,
      ...(typeof rtt === 'number' && { rtt_ms: rtt }),
      ...(typeof jitter === 'number' && { jitter_ms: jitter }),
    },
  };
}

export function extractTwilioServices(status: TwilioStatus): ResultsFragment {
  return { twilio_services: status as Record<string, string> };
}

export function extractBitrate(
  report: MediaConnectionBitrateTest.Report | null,
  error?: Error | null
): ResultsFragment {
  if (error) return { bitrate: { ok: false, error: error.message } };
  if (!report) return { bitrate: { ok: false, error: 'no-report' } };
  const max = report.values && report.values.length > 0 ? Math.max(...report.values) : undefined;
  return {
    bitrate: {
      ok: true,
      ...(max !== undefined && { max_kbps: max }),
      ...(typeof report.averageBitrate === 'number' && { average_kbps: report.averageBitrate }),
    },
  };
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `npx jest src/telemetry/stepExtractors.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 2.5: Commit**

```bash
git add src/telemetry/stepExtractors.ts src/telemetry/stepExtractors.test.ts
git commit -m "AP-43454 feat(telemetry): add stepExtractors mapping state to results fragments"
```

---

## Task 3: `telemetryClient` core — fetch + cumulative buffer

**Files:**
- Create: `src/telemetry/telemetryClient.ts`
- Create: `src/telemetry/telemetryClient.test.ts`

- [ ] **Step 3.1: Write failing test for happy-path POST**

```ts
// src/telemetry/telemetryClient.test.ts

import { createTelemetryClient } from './telemetryClient';

const baseConfig = {
  endpoint: 'https://example.test/runs',
  token: 'abc.sig',
  pageLoadedAt: '2026-05-12T14:23:11.234Z',
};

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('telemetryClient — core', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 204 });
  });

  it('sends a POST with token header and step fragment', async () => {
    const client = createTelemetryClient({ ...baseConfig, fetchImpl: fetchMock });
    client.recordStep({ camera: { ok: true, device: 'FaceTime HD' } });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.test/runs');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer abc.sig');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      diagnostics_page_loaded_at: '2026-05-12T14:23:11.234Z',
      results: { camera: { ok: true, device: 'FaceTime HD' } },
    });
  });

  it('accumulates step fragments across multiple recordStep calls', async () => {
    const client = createTelemetryClient({ ...baseConfig, fetchImpl: fetchMock });
    client.recordStep({ camera: { ok: true } });
    await flushPromises();
    client.recordStep({ microphone: { ok: true } });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).results).toEqual({ microphone: { ok: true } });
  });

  it('serializes requests (queue is FIFO, no parallel in-flight)', async () => {
    let resolveFirst: (v: any) => void;
    fetchMock
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValue({ ok: true, status: 204 });

    const client = createTelemetryClient({ ...baseConfig, fetchImpl: fetchMock });
    client.recordStep({ camera: { ok: true } });
    client.recordStep({ microphone: { ok: true } });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFirst!({ ok: true, status: 204 });
    await flushPromises();
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('swallows fetch errors and calls onError', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    const onError = jest.fn();
    const client = createTelemetryClient({
      ...baseConfig,
      fetchImpl: fetchMock,
      onError,
      retry: { attempts: 1, baseDelayMs: 0 },
    });
    client.recordStep({ camera: { ok: true } });
    await flushPromises();
    await flushPromises();

    expect(onError).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `npx jest src/telemetry/telemetryClient.test.ts`
Expected: FAIL — "Cannot find module './telemetryClient'"

- [ ] **Step 3.3: Implement core `telemetryClient.ts`**

```ts
// src/telemetry/telemetryClient.ts

import type { ResultsFragment } from './types';

export interface TelemetryClientConfig {
  endpoint: string;
  token: string;
  pageLoadedAt: string;
  fetchImpl?: typeof fetch;
  onError?: (e: Error, ctx: { phase: string; attempt?: number }) => void;
  retry?: { attempts: number; baseDelayMs: number };
}

export interface TelemetryClient {
  recordStep(fragment: ResultsFragment): void;
  complete(finalFragment: ResultsFragment): void;
  flushOnUnload(): void;
  destroy(): void;
}

const DEFAULT_RETRY = { attempts: 3, baseDelayMs: 250 };

export function createTelemetryClient(config: TelemetryClientConfig): TelemetryClient {
  const fetchImpl = config.fetchImpl ?? fetch.bind(window);
  const retry = config.retry ?? DEFAULT_RETRY;
  const onError = config.onError ?? (() => {});

  let queue: Promise<void> = Promise.resolve();
  let disabled = false;
  let pendingUnacked: ResultsFragment = {};

  function buildBody(fragment: ResultsFragment): string {
    return JSON.stringify({
      diagnostics_page_loaded_at: config.pageLoadedAt,
      results: fragment,
    });
  }

  async function sendOnce(fragment: ResultsFragment, opts: { keepalive: boolean }): Promise<Response> {
    return fetchImpl(config.endpoint, {
      method: 'POST',
      keepalive: opts.keepalive,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
      },
      body: buildBody(fragment),
    });
  }

  async function sendWithRetry(fragment: ResultsFragment): Promise<void> {
    if (disabled) return;
    pendingUnacked = { ...pendingUnacked, ...fragment };

    for (let attempt = 1; attempt <= retry.attempts; attempt++) {
      try {
        const res = await sendOnce(pendingUnacked, { keepalive: false });
        if (res.ok) {
          pendingUnacked = {};
          return;
        }
        if (res.status >= 400 && res.status < 500) {
          disabled = true;
          onError(new Error(`telemetry disabled: HTTP ${res.status}`), { phase: '4xx' });
          return;
        }
        // 5xx → retry
      } catch (e) {
        onError(e as Error, { phase: 'fetch', attempt });
      }
      if (attempt < retry.attempts) {
        await new Promise((r) => setTimeout(r, retry.baseDelayMs * 2 ** (attempt - 1)));
      }
    }
    onError(new Error('telemetry retries exhausted; data retained in buffer'), { phase: 'give-up' });
  }

  function enqueue(fragment: ResultsFragment): void {
    queue = queue.then(() => sendWithRetry(fragment)).catch(() => {});
  }

  return {
    recordStep(fragment) {
      enqueue(fragment);
    },
    complete(finalFragment) {
      enqueue({ ...finalFragment, completed: true });
    },
    flushOnUnload() {
      // implemented in Task 5
    },
    destroy() {
      // implemented in Task 5
    },
  };
}
```

- [ ] **Step 3.4: Run tests to verify they pass**

Run: `npx jest src/telemetry/telemetryClient.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 3.5: Commit**

```bash
git add src/telemetry/telemetryClient.ts src/telemetry/telemetryClient.test.ts
git commit -m "AP-43454 feat(telemetry): add telemetryClient core with cumulative buffer and queue"
```

---

## Task 4: `telemetryClient` retry/backoff + recovery

**Files:**
- Modify: `src/telemetry/telemetryClient.test.ts`

- [ ] **Step 4.1: Add failing tests for 5xx retry and recovery**

Add the following `describe` block at the bottom of `src/telemetry/telemetryClient.test.ts`:

```ts
describe('telemetryClient — retry & recovery', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
  });

  it('retries on 5xx and succeeds on the second attempt', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 204 });

    const client = createTelemetryClient({
      ...baseConfig,
      fetchImpl: fetchMock,
      retry: { attempts: 3, baseDelayMs: 0 },
    });
    client.recordStep({ camera: { ok: true } });
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retains unacked data and resends it with the next step when retries exhaust', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    const client = createTelemetryClient({
      ...baseConfig,
      fetchImpl: fetchMock,
      retry: { attempts: 2, baseDelayMs: 0 },
    });
    client.recordStep({ camera: { ok: true } });
    await flushPromises();
    await flushPromises();
    await flushPromises();

    // First step exhausted retries — both attempts had camera only.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).results).toEqual({ camera: { ok: true } });

    fetchMock.mockResolvedValue({ ok: true, status: 204 });
    client.recordStep({ microphone: { ok: true } });
    await flushPromises();
    await flushPromises();

    // Third call carries BOTH camera and microphone (recovery via cumulative buffer).
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).results).toEqual({
      camera: { ok: true },
      microphone: { ok: true },
    });
  });

  it('does not retry on 4xx and disables further sends', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    const onError = jest.fn();

    const client = createTelemetryClient({
      ...baseConfig,
      fetchImpl: fetchMock,
      onError,
      retry: { attempts: 3, baseDelayMs: 0 },
    });
    client.recordStep({ camera: { ok: true } });
    await flushPromises();
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('401') }),
      { phase: '4xx' }
    );

    client.recordStep({ microphone: { ok: true } });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1); // no new send
  });
});
```

- [ ] **Step 4.2: Run tests to verify retry + recovery tests pass and 4xx test passes**

Run: `npx jest src/telemetry/telemetryClient.test.ts`
Expected: PASS (7 tests total) — the core implementation from Task 3 already handles these. If any fail, this is where to fix bugs surfaced by the additional tests.

- [ ] **Step 4.3: Commit**

```bash
git add src/telemetry/telemetryClient.test.ts
git commit -m "AP-43454 test(telemetry): cover retry, recovery, and 4xx-disable paths"
```

---

## Task 5: Unload flush via `fetch(keepalive: true)`

**Files:**
- Modify: `src/telemetry/telemetryClient.ts`
- Modify: `src/telemetry/telemetryClient.test.ts`

- [ ] **Step 5.1: Add failing tests for the unload flush**

Add this `describe` block at the bottom of `src/telemetry/telemetryClient.test.ts`:

```ts
describe('telemetryClient — unload flush', () => {
  let fetchMock: jest.Mock;
  let originalVisibility: PropertyDescriptor | undefined;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  });

  afterEach(() => {
    if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
  });

  function setHidden() {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  }

  it('sends keepalive fetch on visibilitychange→hidden when buffer is non-empty', async () => {
    // Make the first POST never resolve so the buffer is non-empty when we go hidden.
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    const client = createTelemetryClient({ ...baseConfig, fetchImpl: fetchMock });
    client.recordStep({ camera: { ok: true } });
    await flushPromises();

    setHidden();
    document.dispatchEvent(new Event('visibilitychange'));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].keepalive).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).results).toEqual({ camera: { ok: true } });

    client.destroy();
  });

  it('sends keepalive fetch on pagehide when buffer is non-empty', async () => {
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    const client = createTelemetryClient({ ...baseConfig, fetchImpl: fetchMock });
    client.recordStep({ microphone: { ok: true } });
    await flushPromises();

    window.dispatchEvent(new Event('pagehide'));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].keepalive).toBe(true);
    client.destroy();
  });

  it('does not send on unload when buffer is empty', async () => {
    const client = createTelemetryClient({ ...baseConfig, fetchImpl: fetchMock });
    // No recordStep — buffer empty.
    setHidden();
    document.dispatchEvent(new Event('visibilitychange'));

    expect(fetchMock).not.toHaveBeenCalled();
    client.destroy();
  });

  it('destroy removes the listeners', async () => {
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    const client = createTelemetryClient({ ...baseConfig, fetchImpl: fetchMock });
    client.recordStep({ camera: { ok: true } });
    await flushPromises();

    client.destroy();
    setHidden();
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));

    expect(fetchMock).toHaveBeenCalledTimes(1); // only the original recordStep call
  });
});
```

- [ ] **Step 5.2: Run tests to verify they fail**

Run: `npx jest src/telemetry/telemetryClient.test.ts`
Expected: FAIL — `flushOnUnload` is a no-op and `destroy` doesn't remove listeners.

- [ ] **Step 5.3: Wire up unload listeners in `telemetryClient.ts`**

Replace the bottom of `createTelemetryClient` (the returned object) and the surrounding closures with this version. The full file now looks like:

```ts
// src/telemetry/telemetryClient.ts

import type { ResultsFragment } from './types';

export interface TelemetryClientConfig {
  endpoint: string;
  token: string;
  pageLoadedAt: string;
  fetchImpl?: typeof fetch;
  onError?: (e: Error, ctx: { phase: string; attempt?: number }) => void;
  retry?: { attempts: number; baseDelayMs: number };
}

export interface TelemetryClient {
  recordStep(fragment: ResultsFragment): void;
  complete(finalFragment: ResultsFragment): void;
  flushOnUnload(): void;
  destroy(): void;
}

const DEFAULT_RETRY = { attempts: 3, baseDelayMs: 250 };

export function createTelemetryClient(config: TelemetryClientConfig): TelemetryClient {
  const fetchImpl = config.fetchImpl ?? fetch.bind(window);
  const retry = config.retry ?? DEFAULT_RETRY;
  const onError = config.onError ?? (() => {});

  let queue: Promise<void> = Promise.resolve();
  let disabled = false;
  let pendingUnacked: ResultsFragment = {};
  let flushed = false;

  function buildBody(fragment: ResultsFragment): string {
    return JSON.stringify({
      diagnostics_page_loaded_at: config.pageLoadedAt,
      results: fragment,
    });
  }

  function sendOnce(fragment: ResultsFragment, opts: { keepalive: boolean }): Promise<Response> {
    return fetchImpl(config.endpoint, {
      method: 'POST',
      keepalive: opts.keepalive,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
      },
      body: buildBody(fragment),
    });
  }

  async function sendWithRetry(fragment: ResultsFragment): Promise<void> {
    if (disabled) return;
    pendingUnacked = { ...pendingUnacked, ...fragment };

    for (let attempt = 1; attempt <= retry.attempts; attempt++) {
      try {
        const res = await sendOnce(pendingUnacked, { keepalive: false });
        if (res.ok) {
          pendingUnacked = {};
          return;
        }
        if (res.status >= 400 && res.status < 500) {
          disabled = true;
          onError(new Error(`telemetry disabled: HTTP ${res.status}`), { phase: '4xx' });
          return;
        }
      } catch (e) {
        onError(e as Error, { phase: 'fetch', attempt });
      }
      if (attempt < retry.attempts) {
        await new Promise((r) => setTimeout(r, retry.baseDelayMs * 2 ** (attempt - 1)));
      }
    }
    onError(new Error('telemetry retries exhausted; data retained in buffer'), { phase: 'give-up' });
  }

  function enqueue(fragment: ResultsFragment): void {
    queue = queue.then(() => sendWithRetry(fragment)).catch(() => {});
  }

  function flushOnUnload(): void {
    if (flushed || disabled) return;
    if (Object.keys(pendingUnacked).length === 0) return;
    flushed = true;
    try {
      sendOnce(pendingUnacked, { keepalive: true }).catch(() => {});
    } catch (e) {
      onError(e as Error, { phase: 'unload' });
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') flushOnUnload();
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', flushOnUnload);

  return {
    recordStep(fragment) {
      enqueue(fragment);
    },
    complete(finalFragment) {
      enqueue({ ...finalFragment, completed: true });
    },
    flushOnUnload,
    destroy() {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flushOnUnload);
    },
  };
}
```

- [ ] **Step 5.4: Run tests to verify they pass**

Run: `npx jest src/telemetry/telemetryClient.test.ts`
Expected: PASS (11 tests total)

- [ ] **Step 5.5: Commit**

```bash
git add src/telemetry/telemetryClient.ts src/telemetry/telemetryClient.test.ts
git commit -m "AP-43454 feat(telemetry): flush unsent results via keepalive fetch on tab close"
```

---

## Task 6: `useTelemetry` — React hook integration

**Files:**
- Create: `src/telemetry/useTelemetry.ts`
- Create: `src/telemetry/useTelemetry.test.tsx`

- [ ] **Step 6.1: Write failing tests**

```tsx
// src/telemetry/useTelemetry.test.tsx

import { act, renderHook } from '@testing-library/react-hooks';
import { useTelemetry } from './useTelemetry';
import { ActivePane } from '../components/AppStateProvider/AppStateProvider';

const fullClaims = {
  v: 1,
  endpoint: 'https://example.test/runs',
  organization_id: 1,
  member_id: 2,
  meeting_id: 3,
  exp: Math.floor(Date.now() / 1000) + 3600,
};

function tokenFor(claims: object): string {
  const payload = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${payload}.sig`;
}

function baseState(overrides: Partial<any> = {}) {
  return {
    activePane: ActivePane.GetStarted,
    audioGranted: false,
    videoGranted: false,
    deviceError: null,
    preflightTest: {
      progress: null,
      report: null,
      error: null,
      tokenError: null,
      signalingGatewayReachable: false,
      turnServersReachable: false,
    },
    twilioStatus: null,
    twilioStatusError: null,
    videoInputTestReport: null,
    audioInputTestReport: null,
    audioOutputTestReport: null,
    downButtonDisabled: false,
    preflightTestInProgress: false,
    preflightTestFinished: false,
    bitrateTest: { bitrate: null, report: null, error: null },
    bitrateTestInProgress: false,
    bitrateTestFinished: false,
    appIsExpired: false,
    ...overrides,
  };
}

const userAgent = { browser: { name: 'Chrome', version: '126' } } as any;

describe('useTelemetry', () => {
  let fetchMock: jest.Mock;
  let originalSearch: string;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    (global as any).fetch = fetchMock;
    originalSearch = window.location.search;
  });

  afterEach(() => {
    window.history.replaceState({}, '', `/${originalSearch}`);
  });

  function setSearch(s: string) {
    window.history.replaceState({}, '', `/${s}`);
  }

  it('is a no-op in demo mode (no t param)', async () => {
    setSearch('');
    renderHook(() => useTelemetry(baseState(), userAgent));
    await new Promise((r) => setImmediate(r));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts camera result when videoInputTestReport transitions null → value', async () => {
    setSearch(`?t=${tokenFor(fullClaims)}`);
    const { rerender } = renderHook(({ state }) => useTelemetry(state, userAgent), {
      initialProps: { state: baseState() },
    });

    rerender({
      state: baseState({
        videoInputTestReport: { errors: [], deviceName: 'FaceTime HD' } as any,
      }),
    });

    await new Promise((r) => setImmediate(r));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.results.camera).toEqual({ ok: true, device: 'FaceTime HD' });
  });

  it('posts completed=true once when activePane reaches Results', async () => {
    setSearch(`?t=${tokenFor(fullClaims)}`);
    const { rerender } = renderHook(({ state }) => useTelemetry(state, userAgent), {
      initialProps: { state: baseState() },
    });

    rerender({ state: baseState({ activePane: ActivePane.Results }) });
    await new Promise((r) => setImmediate(r));
    rerender({ state: baseState({ activePane: ActivePane.Results }) });
    await new Promise((r) => setImmediate(r));

    const completedCalls = fetchMock.mock.calls.filter(
      ([, init]) => JSON.parse(init.body).results.completed === true
    );
    expect(completedCalls).toHaveLength(1);
  });
});
```

- [ ] **Step 6.2: Run tests to verify they fail**

Run: `npx jest src/telemetry/useTelemetry.test.tsx`
Expected: FAIL — "Cannot find module './useTelemetry'"

- [ ] **Step 6.3: Implement `useTelemetry.ts`**

```ts
// src/telemetry/useTelemetry.ts

import { useEffect, useMemo, useRef } from 'react';
import type UAParser from 'ua-parser-js';
import { ActivePane } from '../components/AppStateProvider/AppStateProvider';
import { parseToken } from './parseToken';
import { createTelemetryClient, type TelemetryClient } from './telemetryClient';
import {
  extractBrowser,
  extractBitrate,
  extractCamera,
  extractMicrophone,
  extractNetwork,
  extractPermissions,
  extractSpeaker,
  extractTwilioServices,
} from './stepExtractors';

const isDev = process.env.NODE_ENV !== 'production';
function devLog(...args: unknown[]) {
  if (isDev) console.warn('[telemetry]', ...args);
}

interface AppLikeState {
  activePane: ActivePane;
  audioGranted: boolean;
  videoGranted: boolean;
  videoInputTestReport: any;
  audioInputTestReport: any;
  audioOutputTestReport: any;
  preflightTest: {
    report: any;
    signalingGatewayReachable: boolean;
    turnServersReachable: boolean;
  };
  preflightTestFinished: boolean;
  twilioStatus: any;
  bitrateTest: { report: any; error: Error | null };
  bitrateTestFinished: boolean;
}

export function useTelemetry(state: AppLikeState, userAgent: UAParser.IResult): void {
  const clientRef = useRef<TelemetryClient | null>(null);
  const sentRef = useRef({
    permissions: false,
    browser: false,
    camera: false,
    microphone: false,
    speaker: false,
    network: false,
    twilioServices: false,
    bitrate: false,
    completed: false,
  });

  const mode = useMemo(() => parseToken(window.location.search), []);

  useEffect(() => {
    if (mode.mode !== 'post') {
      devLog('demo mode:', mode.reason);
      return;
    }
    const client = createTelemetryClient({
      endpoint: mode.endpoint,
      token: mode.rawToken,
      pageLoadedAt: new Date().toISOString(),
      onError: (e, ctx) => devLog(ctx.phase, e.message),
    });
    clientRef.current = client;
    return () => client.destroy();
  }, [mode]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    const sent = sentRef.current;

    if (!sent.browser && userAgent.browser?.name) {
      client.recordStep(extractBrowser(userAgent));
      sent.browser = true;
    }
    if (!sent.permissions && (state.audioGranted || state.videoGranted)) {
      client.recordStep(extractPermissions(state.audioGranted, state.videoGranted));
      sent.permissions = true;
    }
    if (!sent.camera && state.videoInputTestReport) {
      client.recordStep(extractCamera(state.videoInputTestReport));
      sent.camera = true;
    }
    if (!sent.microphone && state.audioInputTestReport) {
      client.recordStep(extractMicrophone(state.audioInputTestReport));
      sent.microphone = true;
    }
    if (!sent.speaker && state.audioOutputTestReport) {
      client.recordStep(extractSpeaker(state.audioOutputTestReport));
      sent.speaker = true;
    }
    if (!sent.network && state.preflightTestFinished) {
      client.recordStep(
        extractNetwork(
          state.preflightTest.report,
          state.preflightTest.signalingGatewayReachable,
          state.preflightTest.turnServersReachable
        )
      );
      sent.network = true;
    }
    if (!sent.twilioServices && state.twilioStatus) {
      client.recordStep(extractTwilioServices(state.twilioStatus));
      sent.twilioServices = true;
    }
    if (!sent.bitrate && state.bitrateTestFinished) {
      client.recordStep(extractBitrate(state.bitrateTest.report, state.bitrateTest.error));
      sent.bitrate = true;
    }
    if (!sent.completed && state.activePane === ActivePane.Results) {
      client.complete({});
      sent.completed = true;
    }
  }, [state, userAgent]);
}
```

- [ ] **Step 6.4: Run tests to verify they pass**

Run: `npx jest src/telemetry/useTelemetry.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 6.5: Commit**

```bash
git add src/telemetry/useTelemetry.ts src/telemetry/useTelemetry.test.tsx
git commit -m "AP-43454 feat(telemetry): add useTelemetry hook that posts per step transition"
```

---

## Task 7: Barrel + integrate into `AppStateProvider`

**Files:**
- Create: `src/telemetry/index.ts`
- Modify: `src/components/AppStateProvider/AppStateProvider.tsx`

- [ ] **Step 7.1: Create the barrel `index.ts`**

```ts
// src/telemetry/index.ts

export { useTelemetry } from './useTelemetry';
export { parseToken } from './parseToken';
export { createTelemetryClient } from './telemetryClient';
export type { TelemetryClient, TelemetryClientConfig } from './telemetryClient';
export type { ResultsFragment, TelemetryMode, TokenClaims } from './types';
```

- [ ] **Step 7.2: Wire `useTelemetry` into `AppStateProvider`**

Modify `src/components/AppStateProvider/AppStateProvider.tsx`. Add the import at the top of the imports block:

```ts
import { useTelemetry } from '../../telemetry';
```

Inside `AppStateProvider`, after the existing `useReducer` line (line 322) and the existing `userAgentInfo` derivation (line 327–328), add one call:

```ts
useTelemetry(state, userAgentInfo);
```

The function should now look like:

```ts
export const AppStateProvider: React.FC = ({ children }) => {
  const [state, dispatch] = useReducer(appStateReducer, initialState);
  const { startPreflightTest } = usePreflightTest(dispatch);
  const { startBitrateTest } = useBitrateTest(dispatch);
  const { getTwilioStatus } = useTwilioStatus(dispatch);

  const userAgentParser = new UAParser();
  const userAgentInfo = userAgentParser.getResult();

  useTelemetry(state, userAgentInfo);
  // ... rest unchanged
```

- [ ] **Step 7.3: Run the full app test suite to confirm no regression**

Run: `npx jest --config jest.config.js`
Expected: PASS for every existing test plus the new `src/telemetry/*` tests. If `AppStateProvider.test.tsx` fails because `fetch` is undefined or `window.location.search` is unset, add `(global as any).fetch = jest.fn();` in a `beforeEach` and set `window.history.replaceState({}, '', '/')` to force demo mode (which is the default for existing tests).

- [ ] **Step 7.4: Commit**

```bash
git add src/telemetry/index.ts src/components/AppStateProvider/AppStateProvider.tsx
git commit -m "AP-43454 feat(telemetry): wire useTelemetry into AppStateProvider"
```

---

## Task 8: Module README

**Files:**
- Create: `src/telemetry/README.md`

- [ ] **Step 8.1: Write a short README documenting the module**

```markdown
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
  "results": { "camera": { "ok": true, "device": "FaceTime HD" } }
}
```

The `results` object accumulates client-side and every POST carries any
un-ACKed deltas, so a transient failure self-heals via the server's
`deep_merge`.

## Transport

`fetch(..., { keepalive: true })` only. On `visibilitychange→hidden` or
`pagehide`, any un-ACKed buffer is flushed with `keepalive: true` so the
browser can complete delivery as the tab unloads.

## Failure handling

- 5xx → 3 retries, 250 ms / 500 ms / 1 s backoff, then drop (data stays in
  the cumulative buffer and rides the next step's POST).
- 4xx → disable for the rest of the session.
- Anything thrown is caught, logged via `console.warn` in dev, and silently
  dropped in prod.

## Debugging

Add `console.warn` breakpoints on `[telemetry]` log lines. There is no UI
overlay; use DevTools' Network tab to inspect POSTs.
```

- [ ] **Step 8.2: Commit**

```bash
git add src/telemetry/README.md
git commit -m "AP-43454 docs(telemetry): add module README"
```

---

## Self-Review checklist (run after Task 8)

- [ ] Spec coverage: every section of `2026-05-12-video-diagnostics-telemetry-design.md` that lists a frontend obligation is implemented (token parse, POST per step, `diagnostics_page_loaded_at` stable per session, `Authorization: Bearer`, keepalive flush, completed=true on Results).
- [ ] No placeholders, no TODOs, no "implement later" in the code.
- [ ] Type names consistent across tasks: `TelemetryClient`, `TelemetryClientConfig`, `ResultsFragment`, `TokenClaims`, `TelemetryMode`.
- [ ] Run `npm run lint` and `npm run test` and `npm run build`, expect green.
- [ ] Smoke test in the browser: append `?t=<a-real-token-from-staging-Rails>` and verify network tab shows `POST /video_call_diagnostic_runs` with `204` status as each step completes.
