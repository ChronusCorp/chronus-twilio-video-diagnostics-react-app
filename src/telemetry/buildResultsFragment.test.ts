import {
  buildResultsFragment,
  stripBitrateForWire,
  stripPreflightForWire,
  stripAudioInputForWire,
} from './buildResultsFragment';
import { ActivePane } from '../components/AppStateProvider/types';

const userAgent = { browser: { name: 'Chrome', version: '126' }, os: { name: 'macOS' } } as any;

function baseState(overrides: Partial<any> = {}) {
  return {
    activePane: ActivePane.GetStarted,
    audioInputTestReport: null,
    audioOutputTestReport: null,
    videoInputTestReport: null,
    preflightTest: {
      report: null,
      error: null,
      tokenError: null,
      signalingGatewayReachable: false,
      turnServersReachable: false,
    },
    preflightTestFinished: false,
    twilioStatus: null,
    bitrateTest: { report: null, error: null },
    bitrateTestFinished: false,
    ...overrides,
  };
}

describe('strip helpers', () => {
  it('stripBitrateForWire drops iceCandidateStats, preserves all other fields', () => {
    const report = {
      averageBitrate: 1800,
      values: [800, 1200],
      errors: [],
      iceCandidateStats: [{ candidateType: 'host' }, { candidateType: 'relay' }],
      testName: 'media-connection-bitrate-test',
    };
    const stripped = stripBitrateForWire(report as any);
    expect(stripped).not.toHaveProperty('iceCandidateStats');
    expect(stripped).toEqual({
      averageBitrate: 1800,
      values: [800, 1200],
      errors: [],
      testName: 'media-connection-bitrate-test',
    });
  });

  it('stripBitrateForWire returns null when input is null', () => {
    expect(stripBitrateForWire(null)).toBeNull();
  });

  it('stripPreflightForWire drops iceCandidateStats, preserves all other fields', () => {
    const report = {
      testTiming: { duration: 12345 },
      networkTiming: { connect: { duration: 100 } },
      stats: { rtt: { average: 42 } },
      iceCandidateStats: [{ candidateType: 'host' }],
      selectedIceCandidatePairStats: { localCandidate: {}, remoteCandidate: {} },
      progressEvents: [],
    };
    const stripped = stripPreflightForWire(report as any);
    expect(stripped).not.toHaveProperty('iceCandidateStats');
    expect(stripped).toHaveProperty('testTiming');
    expect(stripped).toHaveProperty('stats');
    expect(stripped).toHaveProperty('selectedIceCandidatePairStats');
  });

  it('stripPreflightForWire returns null when input is null', () => {
    expect(stripPreflightForWire(null)).toBeNull();
  });

  it('stripAudioInputForWire drops recordingUrl and values, preserves all other fields', () => {
    const report = {
      deviceId: 'mic-0',
      errors: [],
      recordingUrl: 'blob:http://example.test/abc-123',
      values: [10, 20, 30],
      testName: 'audio-input-test',
      testTiming: { start: 0, end: 1000, duration: 1000 },
    };
    const stripped = stripAudioInputForWire(report as any);
    expect(stripped).not.toHaveProperty('recordingUrl');
    expect(stripped).not.toHaveProperty('values');
    expect(stripped).toEqual({
      deviceId: 'mic-0',
      errors: [],
      testName: 'audio-input-test',
      testTiming: { start: 0, end: 1000, duration: 1000 },
    });
  });

  it('stripAudioInputForWire returns null when input is null', () => {
    expect(stripAudioInputForWire(null)).toBeNull();
  });
});

describe('buildResultsFragment', () => {
  it('returns only browserInformation when only UA is known and no test reports yet', () => {
    expect(buildResultsFragment(baseState(), userAgent)).toEqual({ browserInformation: userAgent });
  });

  it('omits browserInformation when UA has no browser name', () => {
    const ua = { browser: {} } as any;
    expect(buildResultsFragment(baseState(), ua)).toEqual({});
  });

  it('emits videoTestResults when videoInputTestReport is set', () => {
    const report = { errors: [], deviceId: 'cam-0' };
    const out = buildResultsFragment(baseState({ videoInputTestReport: report }), userAgent);
    expect(out.videoTestResults).toBe(report);
  });

  it('emits audioTestResults with recordingUrl and values stripped from inputTest', () => {
    const inputReport = {
      errors: [],
      deviceId: 'mic-0',
      recordingUrl: 'blob:http://x/y',
      values: [10, 20, 30, 40],
    };
    const out = buildResultsFragment(baseState({ audioInputTestReport: inputReport }), userAgent);
    expect(out.audioTestResults).toBeDefined();
    expect(out.audioTestResults!.inputTest).not.toHaveProperty('recordingUrl');
    expect(out.audioTestResults!.inputTest).not.toHaveProperty('values');
    expect(out.audioTestResults!.inputTest).toEqual({ errors: [], deviceId: 'mic-0' });
    expect(out.audioTestResults!.outputTest).toBeNull();
  });

  it('emits audioTestResults with both inputTest and outputTest when both are set', () => {
    const inputReport = { errors: [], deviceId: 'mic-0' };
    const outputReport = { errors: [], deviceId: 'speaker-0' };
    const out = buildResultsFragment(
      baseState({ audioInputTestReport: inputReport, audioOutputTestReport: outputReport }),
      userAgent
    );
    expect(out.audioTestResults).toEqual({ inputTest: inputReport, outputTest: outputReport });
  });

  it('emits preflightTestReport with iceCandidateStats stripped from the report', () => {
    const report = { stats: { rtt: { average: 42 } }, iceCandidateStats: [{ candidateType: 'host' }] };
    const out = buildResultsFragment(
      baseState({ preflightTestFinished: true, preflightTest: { ...baseState().preflightTest, report } }),
      userAgent
    );
    expect(out.preflightTestReport!.report).not.toHaveProperty('iceCandidateStats');
    expect(out.preflightTestReport!.report).toEqual({ stats: { rtt: { average: 42 } } });
    expect(out.preflightTestReport!.error).toBeNull();
  });

  it('preflightTestReport.error carries a regular preflight error verbatim', () => {
    const out = buildResultsFragment(
      baseState({
        preflightTestFinished: true,
        preflightTest: { ...baseState().preflightTest, error: new Error('TURN unreachable') },
      }),
      userAgent
    );
    expect(out.preflightTestReport!.error).toBe('TURN unreachable');
  });

  it('preflightTestReport.error carries a Chronus-tagged token error when only tokenError is set', () => {
    const out = buildResultsFragment(
      baseState({
        preflightTestFinished: true,
        preflightTest: { ...baseState().preflightTest, tokenError: new Error('token server expired') },
      }),
      userAgent
    );
    expect(out.preflightTestReport!.error).toBe('[chronus] preflight token error: token server expired');
  });

  it('emits connectivityResults with Reachable/Unreachable strings when preflight is finished', () => {
    const out = buildResultsFragment(
      baseState({
        preflightTestFinished: true,
        preflightTest: {
          ...baseState().preflightTest,
          signalingGatewayReachable: true,
          turnServersReachable: false,
        },
      }),
      userAgent
    );
    expect(out.connectivityResults).toEqual({
      twilioServices: {},
      signalingRegion: 'Reachable',
      TURN: 'Unreachable',
    });
  });

  it('emits connectivityResults with twilioServices when twilioStatus is set (even before preflight)', () => {
    const status = { 'Group Rooms': 'operational' };
    const out = buildResultsFragment(baseState({ twilioStatus: status }), userAgent);
    expect(out.connectivityResults).toEqual({
      twilioServices: status,
      signalingRegion: 'Unreachable',
      TURN: 'Unreachable',
    });
  });

  it('emits bitrateTestResults with iceCandidateStats stripped and maxBitrate derived from values', () => {
    const report = {
      averageBitrate: 1000,
      values: [800, 1200, 1100],
      errors: [],
      iceCandidateStats: [{ candidateType: 'host' }],
    };
    const out = buildResultsFragment(
      baseState({ bitrateTestFinished: true, bitrateTest: { report, error: null } }),
      userAgent
    );
    expect(out.bitrateTestResults).not.toHaveProperty('iceCandidateStats');
    expect(out.bitrateTestResults).toEqual({
      maxBitrate: 1200,
      averageBitrate: 1000,
      values: [800, 1200, 1100],
      errors: [],
    });
  });

  it('emits bitrateTestResults with maxBitrate=0 when report is null (matches download fallback)', () => {
    const out = buildResultsFragment(
      baseState({ bitrateTestFinished: true, bitrateTest: { report: null, error: null } }),
      userAgent
    );
    expect(out.bitrateTestResults).toEqual({ maxBitrate: 0 });
  });

  it('emits completed:true once activePane reaches Results', () => {
    const out = buildResultsFragment(baseState({ activePane: ActivePane.Results }), userAgent);
    expect(out.completed).toBe(true);
  });

  it('does not include completed when activePane is not Results', () => {
    const out = buildResultsFragment(baseState({ activePane: ActivePane.CameraTest }), userAgent);
    expect(out.completed).toBeUndefined();
  });
});
