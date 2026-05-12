import { useEffect, useMemo, useRef } from 'react';
import type UAParser from 'ua-parser-js';
import { ActivePane } from '../components/AppStateProvider/types';
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
