import { createTelemetryClient } from './telemetryClient';

const baseConfig = {
  endpoint: 'https://example.test/runs',
  token: 'abc.sig',
  pageLoadedAt: '2026-05-12T14:23:11.234Z',
};

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('telemetryClient — core', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 204 });
  });

  it('sends a POST with token header and step fragment', async () => {
    const client = createTelemetryClient({ ...baseConfig, fetchImpl: fetchMock });
    client.recordStep({ camera: { ok: true } });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.test/runs');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer abc.sig');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      diagnostics_page_loaded_at: '2026-05-12T14:23:11.234Z',
      results: { camera: { ok: true } },
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
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveFirst = r;
          })
      )
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
