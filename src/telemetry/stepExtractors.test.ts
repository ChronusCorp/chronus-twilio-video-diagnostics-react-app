import {
  extractBrowser,
  extractPermissions,
  extractCamera,
  extractMicrophone,
  extractSpeaker,
  extractNetwork,
  extractTwilioServices,
  extractBitrate,
} from './stepExtractors';

describe('stepExtractors', () => {
  describe('extractBrowser', () => {
    it('returns ok=true when browser info is present', () => {
      const ua = { browser: { name: 'Chrome', version: '126' } } as any;
      expect(extractBrowser(ua)).toEqual({ browser: { ok: true, name: 'Chrome', version: '126' } });
    });
    it('returns ok=false when browser is unknown', () => {
      const ua = { browser: {} } as any;
      expect(extractBrowser(ua)).toEqual({ browser: { ok: false } });
    });
  });

  describe('extractPermissions', () => {
    it('returns ok=true when both granted', () => {
      expect(extractPermissions(true, true)).toEqual({ permissions: { ok: true } });
    });
    it('returns ok=false with denied list when audio is denied', () => {
      expect(extractPermissions(false, true)).toEqual({ permissions: { ok: false, denied: ['microphone'] } });
    });
    it('returns both denied when neither granted', () => {
      expect(extractPermissions(false, false)).toEqual({
        permissions: { ok: false, denied: ['microphone', 'camera'] },
      });
    });
  });

  describe('extractCamera', () => {
    it('returns ok=true on success', () => {
      const report = { errors: [] } as any;
      expect(extractCamera(report)).toEqual({ camera: { ok: true } });
    });
    it('returns ok=false with error on failure', () => {
      const report = { errors: [{ name: 'NotReadableError', message: 'in use' }] } as any;
      expect(extractCamera(report)).toEqual({ camera: { ok: false, error: 'NotReadableError' } });
    });
  });

  describe('extractMicrophone', () => {
    it('returns ok=true with input level on success', () => {
      const report = { errors: [], values: [-30, -20, -10] } as any;
      expect(extractMicrophone(report)).toEqual({ microphone: { ok: true, input_level: -10 } });
    });
    it('returns ok=false with error on failure', () => {
      const report = { errors: [{ name: 'NotAllowedError' }], values: [] } as any;
      expect(extractMicrophone(report)).toEqual({ microphone: { ok: false, error: 'NotAllowedError' } });
    });
  });

  describe('extractSpeaker', () => {
    it('returns ok=true on success', () => {
      expect(extractSpeaker({ errors: [] } as any)).toEqual({ speaker: { ok: true } });
    });
    it('returns ok=false with error on failure', () => {
      expect(extractSpeaker({ errors: [{ name: 'DeviceError' }] } as any)).toEqual({
        speaker: { ok: false, error: 'DeviceError' },
      });
    });
  });

  describe('extractNetwork', () => {
    it('returns ok=true with rtt and jitter from preflight report', () => {
      const report = {
        stats: { rtt: { average: 42 }, jitter: { average: 6 } },
      } as any;
      const out = extractNetwork(report, true, true);
      expect(out.network!.ok).toBe(true);
      expect(out.network!.rtt_ms).toBe(42);
      expect(out.network!.jitter_ms).toBe(6);
      expect(out.network!.signaling_reachable).toBe(true);
      expect(out.network!.turn_reachable).toBe(true);
    });
    it('returns ok=false if signaling unreachable', () => {
      expect(extractNetwork(null, false, false)).toEqual({
        network: { ok: false, signaling_reachable: false, turn_reachable: false },
      });
    });
    it('omits rtt_ms and jitter_ms when stats are null', () => {
      const report = { stats: { rtt: null, jitter: null, packetLoss: null } } as any;
      expect(extractNetwork(report, true, true)).toEqual({
        network: { ok: true, signaling_reachable: true, turn_reachable: true },
      });
    });
    it('returns ok=false with error message when preflight has a regular error', () => {
      const err = new Error('TURN unreachable');
      expect(extractNetwork(null, true, false, err, null)).toEqual({
        network: { ok: false, signaling_reachable: true, turn_reachable: false, error: 'TURN unreachable' },
      });
    });
    it('returns ok=false with token error message when preflight has a tokenError', () => {
      const tokenErr = new Error('token server expired');
      expect(extractNetwork(null, true, true, null, tokenErr)).toEqual({
        network: { ok: false, signaling_reachable: true, turn_reachable: true, error: 'token server expired' },
      });
    });
  });

  describe('extractTwilioServices', () => {
    it('returns the twilio_services map', () => {
      const status = { 'Group Rooms': 'operational' } as any;
      expect(extractTwilioServices(status)).toEqual({ twilio_services: { 'Group Rooms': 'operational' } });
    });
  });

  describe('extractBitrate', () => {
    it('returns ok=true with max from values array', () => {
      const report = { values: [800, 1200, 1180], averageBitrate: 1060, errors: [] } as any;
      expect(extractBitrate(report)).toEqual({
        bitrate: { ok: true, max_kbps: 1200, average_kbps: 1060 },
      });
    });
    it('returns ok=false with error on failure', () => {
      expect(extractBitrate(null, new Error('TURN unreachable'))).toEqual({
        bitrate: { ok: false, error: 'TURN unreachable' },
      });
    });
    it('returns ok=false when report has errors and no explicit Error arg', () => {
      const report = { values: [], averageBitrate: 0, errors: [{ name: 'TURNError' }] } as any;
      expect(extractBitrate(report)).toEqual({ bitrate: { ok: false, error: 'TURNError' } });
    });
  });
});
