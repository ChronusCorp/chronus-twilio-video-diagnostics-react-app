import type UAParser from 'ua-parser-js';
import type { PreflightTestReport } from 'twilio-video';
import type { AudioInputTest, MediaConnectionBitrateTest } from '@twilio/rtc-diagnostics';
import type { ResultsFragment, Reachability } from './types';
import { ActivePane } from '../components/AppStateProvider/types';
import { formatPreflightError } from '../utils/formatPreflightError';

// State slice consumed by the fragment builder. Matches the relevant subset of
// AppStateProvider state — typed loose-ish (`any` on report objects) because
// the upstream twilio types are deeply nested and this module just passes
// reports through to the wire without inspecting them.
interface FragmentInput {
  activePane: ActivePane;
  audioInputTestReport: any;
  audioOutputTestReport: any;
  videoInputTestReport: any;
  preflightTest: {
    report: any;
    error: Error | null;
    tokenError: Error | null;
    signalingGatewayReachable: boolean;
    turnServersReachable: boolean;
  };
  preflightTestFinished: boolean;
  twilioStatus: any;
  bitrateTest: { report: any; error: Error | null };
  bitrateTestFinished: boolean;
}

function reachability(b: boolean): Reachability {
  return b ? 'Reachable' : 'Unreachable';
}

// --- Wire-only field strips ---
// Each helper drops fields that bloat the wire payload OR carry data that's
// useless to the backend. The download keeps all fields for forensic debugging;
// see src/telemetry/README.md for the full divergence list.

export function stripBitrateForWire(
  report: MediaConnectionBitrateTest.Report | null
): Omit<MediaConnectionBitrateTest.Report, 'iceCandidateStats'> | null {
  if (!report) return null;
  const { iceCandidateStats: _ice, ...rest } = report;
  return rest;
}

export function stripPreflightForWire(
  report: PreflightTestReport | null
): Omit<PreflightTestReport, 'iceCandidateStats'> | null {
  if (!report) return null;
  const { iceCandidateStats: _ice, ...rest } = report;
  return rest;
}

export function stripAudioInputForWire(
  report: AudioInputTest.Report | null
): Omit<AudioInputTest.Report, 'recordingUrl' | 'values'> | null {
  if (!report) return null;
  // `recordingUrl` is a `blob:` URL valid only in the originating browser;
  // sending it to a backend stores a string that no client can ever resolve.
  // `values` is the audio-level sample array (~100 numbers); we don't need
  // the per-sample timeline server-side.
  const { recordingUrl: _url, values: _values, ...rest } = report;
  return rest;
}

export function buildResultsFragment(state: FragmentInput, ua: UAParser.IResult): ResultsFragment {
  const out: ResultsFragment = {};

  if (ua.browser?.name) out.browserInformation = ua;

  if (state.videoInputTestReport) out.videoTestResults = state.videoInputTestReport;

  if (state.audioInputTestReport || state.audioOutputTestReport) {
    out.audioTestResults = {
      inputTest: stripAudioInputForWire(state.audioInputTestReport),
      outputTest: state.audioOutputTestReport,
    };
  }

  if (state.preflightTestFinished) {
    out.preflightTestReport = {
      report: stripPreflightForWire(state.preflightTest.report),
      error: formatPreflightError(state.preflightTest.error, state.preflightTest.tokenError),
    };
  }

  if (state.preflightTestFinished || state.twilioStatus) {
    out.connectivityResults = {
      twilioServices: state.twilioStatus ?? {},
      signalingRegion: reachability(state.preflightTest.signalingGatewayReachable),
      TURN: reachability(state.preflightTest.turnServersReachable),
    };
  }

  if (state.bitrateTestFinished) {
    const bitrateReport = stripBitrateForWire(state.bitrateTest.report);
    const maxBitrate = bitrateReport?.values ? Math.max(...bitrateReport.values) : 0;
    out.bitrateTestResults = { maxBitrate, ...bitrateReport };
  }

  if (state.activePane === ActivePane.Results) out.completed = true;

  return out;
}
