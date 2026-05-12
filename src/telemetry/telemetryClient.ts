import type { ResultsFragment } from './types';

// Browser-only — depends on `fetch` and (in Task 5) `document`/`window` listeners.

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

  // onError fires once per failed attempt (phase:'fetch') AND once at the end
  // when all attempts fail (phase:'give-up'). Consumers should de-duplicate
  // by phase if they don't want both.
  async function sendWithRetry(fragment: ResultsFragment): Promise<void> {
    if (disabled) return;
    // Shallow merge — extractors always produce a complete top-level subtree.
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
