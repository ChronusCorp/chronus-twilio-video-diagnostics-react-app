import type { PreflightTestReport } from 'twilio-video';
import type {
  AudioInputTest,
  AudioOutputTest,
  MediaConnectionBitrateTest,
  VideoInputTest,
} from '@twilio/rtc-diagnostics';
import type UAParser from 'ua-parser-js';
import type { TwilioStatus } from '../components/AppStateProvider/types';

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

export type Reachability = 'Reachable' | 'Unreachable';

// Mirrors the shape produced by AppStateProvider's `downloadFinalTestResults`
// (the JSON file the user can download from the Results pane). Every key is
// optional because telemetry POSTs are incremental — each POST carries only
// the sections that changed since the last successful POST.
//
// Four fields are stripped from telemetry only (download keeps them):
//   audioTestResults.inputTest.recordingUrl  (blob URL — dead data on backend)
//   audioTestResults.inputTest.values        (~100-sample audio-level array)
//   bitrateTestResults.iceCandidateStats     (~2–6 KB of ICE candidate info)
//   preflightTestReport.report.iceCandidateStats  (same shape, in preflight)
// The Omit<>s below encode this contract at the type level — touching one of
// these stripped fields on a ResultsFragment is a compile error.
export interface ResultsFragment {
  audioTestResults?: {
    inputTest: Omit<AudioInputTest.Report, 'recordingUrl' | 'values'> | null;
    outputTest: AudioOutputTest.Report | null;
  };
  bitrateTestResults?: { maxBitrate: number } & Partial<Omit<MediaConnectionBitrateTest.Report, 'iceCandidateStats'>>;
  browserInformation?: UAParser.IResult;
  connectivityResults?: {
    // TwilioStatus's keys are all optional, so `{}` is a valid value when
    // `state.twilioStatus` is null and we coerce to {}.
    twilioServices: TwilioStatus;
    signalingRegion: Reachability;
    TURN: Reachability;
  };
  preflightTestReport?: { report: Omit<PreflightTestReport, 'iceCandidateStats'> | null; error: string | null };
  videoTestResults?: VideoInputTest.Report | null;
  completed?: boolean;
}
