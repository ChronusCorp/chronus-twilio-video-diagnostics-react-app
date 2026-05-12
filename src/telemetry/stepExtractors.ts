import type { ResultsFragment } from './types';
import type UAParser from 'ua-parser-js';
import type { PreflightTestReport } from 'twilio-video';
import type {
  AudioInputTest,
  AudioOutputTest,
  MediaConnectionBitrateTest,
  VideoInputTest,
} from '@twilio/rtc-diagnostics';
import type { TwilioStatus } from '../components/AppStateProvider/types';

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
  if (report.errors && report.errors.length > 0) {
    return { camera: { ok: false, error: report.errors[0].name } };
  }
  return { camera: { ok: true } };
}

export function extractMicrophone(report: AudioInputTest.Report): ResultsFragment {
  if (report.errors && report.errors.length > 0) {
    return { microphone: { ok: false, error: report.errors[0].name } };
  }
  const max = report.values && report.values.length > 0 ? Math.max(...report.values) : undefined;
  return { microphone: { ok: true, ...(max !== undefined && { input_level: max }) } };
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
  if (report.errors && report.errors.length > 0) {
    return { bitrate: { ok: false, error: report.errors[0].name } };
  }
  const max = report.values && report.values.length > 0 ? Math.max(...report.values) : undefined;
  return {
    bitrate: {
      ok: true,
      ...(max !== undefined && { max_kbps: max }),
      ...(typeof report.averageBitrate === 'number' && { average_kbps: report.averageBitrate }),
    },
  };
}
