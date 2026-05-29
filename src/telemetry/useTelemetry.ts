import { useEffect, useMemo, useRef } from 'react';
import type UAParser from 'ua-parser-js';
import { ActivePane } from '../components/AppStateProvider/types';
import { parseToken } from './parseToken';
import { createTelemetryClient, type TelemetryClient } from './telemetryClient';
import type { ResultsFragment } from './types';
import { buildResultsFragment } from './buildResultsFragment';

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
    error: Error | null;
    tokenError: Error | null;
  };
  preflightTestFinished: boolean;
  twilioStatus: any;
  bitrateTest: { report: any; error: Error | null };
  bitrateTestFinished: boolean;
}

// Equality used for top-level section diffing. Sections are either referentially
// stable (userAgentInfo, dispatched reports — `===` matches) or freshly built each
// render (audioTestResults, connectivityResults — JSON stringify falls back to
// content comparison). Both branches are deterministic because we control the
// construction order of every object that flows through here.
function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useTelemetry(state: AppLikeState, userAgent: UAParser.IResult): void {
  const clientRef = useRef<TelemetryClient | null>(null);
  const lastSentRef = useRef<ResultsFragment>({});

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

    const next = buildResultsFragment(state, userAgent);
    const prev = lastSentRef.current;
    const diff: ResultsFragment = {};
    let changed = false;

    (Object.keys(next) as Array<keyof ResultsFragment>).forEach((key) => {
      if (!isEqual(prev[key], next[key])) {
        (diff as any)[key] = next[key];
        changed = true;
      }
    });

    if (!changed) return;
    // `completed: true` is just another diffed key — recordStep and complete
    // are operationally identical (the latter just injects completed:true,
    // which our diff already carries when activePane === Results).
    client.recordStep(diff);
    lastSentRef.current = next;
  }, [state, userAgent]);
}
