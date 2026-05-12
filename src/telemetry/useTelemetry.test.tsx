import { renderHook } from '@testing-library/react-hooks';
import { useTelemetry } from './useTelemetry';
import { ActivePane } from '../components/AppStateProvider/types';

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
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts camera result when videoInputTestReport transitions null → value', async () => {
    setSearch(`?t=${tokenFor(fullClaims)}`);
    const { rerender } = renderHook(({ state }) => useTelemetry(state, userAgent), {
      initialProps: { state: baseState() },
    });

    rerender({
      state: baseState({
        videoInputTestReport: { errors: [] } as any,
      }),
    });

    await new Promise((r) => setTimeout(r, 0));
    // Camera transition + browser (on mount) may both have fired — find the camera POST.
    const cameraCall = fetchMock.mock.calls.find(([, init]) => JSON.parse(init.body).results.camera);
    expect(cameraCall).toBeDefined();
    expect(JSON.parse(cameraCall![1].body).results.camera).toEqual({ ok: true });
  });

  it('posts completed=true once when activePane reaches Results', async () => {
    setSearch(`?t=${tokenFor(fullClaims)}`);
    const { rerender } = renderHook(({ state }) => useTelemetry(state, userAgent), {
      initialProps: { state: baseState() },
    });

    rerender({ state: baseState({ activePane: ActivePane.Results }) });
    await new Promise((r) => setTimeout(r, 0));
    rerender({ state: baseState({ activePane: ActivePane.Results }) });
    await new Promise((r) => setTimeout(r, 0));

    const completedCalls = fetchMock.mock.calls.filter(([, init]) => JSON.parse(init.body).results.completed === true);
    expect(completedCalls).toHaveLength(1);
  });
});
