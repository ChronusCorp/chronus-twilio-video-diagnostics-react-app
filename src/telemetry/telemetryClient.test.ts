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

describe('telemetryClient — retry & recovery', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
  });

  it('retries on 5xx and succeeds on the second attempt', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: true, status: 204 });

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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).results).toEqual({ camera: { ok: true } });

    fetchMock.mockResolvedValue({ ok: true, status: 204 });
    client.recordStep({ microphone: { ok: true } });
    await flushPromises();
    await flushPromises();

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
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('401') }), {
      phase: '4xx',
    });

    client.recordStep({ microphone: { ok: true } });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1); // no new send
  });
});
