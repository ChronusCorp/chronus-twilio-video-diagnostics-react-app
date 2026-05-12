import { parseToken } from './parseToken';

function buildToken(claims: object): string {
  const payload = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${payload}.sig`;
}

const validClaims = {
  v: 1,
  endpoint: 'https://mentoreu.chronus.com/video_call_diagnostic_runs',
  organization_id: 42,
  member_id: 12345,
  meeting_id: 98765,
  exp: Math.floor(Date.now() / 1000) + 3600,
};

describe('parseToken', () => {
  it('returns post mode for a fully valid token', () => {
    const result = parseToken(`?t=${buildToken(validClaims)}`);
    expect(result.mode).toBe('post');
    if (result.mode === 'post') {
      expect(result.endpoint).toBe(validClaims.endpoint);
      expect(result.claims.member_id).toBe(12345);
    }
  });

  it('returns demo mode when t param is absent', () => {
    expect(parseToken('')).toEqual({ mode: 'demo', reason: 'no-token' });
    expect(parseToken('?other=1')).toEqual({ mode: 'demo', reason: 'no-token' });
  });

  it('returns demo mode for malformed base64', () => {
    expect(parseToken('?t=!!!.sig')).toEqual({ mode: 'demo', reason: 'malformed' });
  });

  it('returns demo mode when token is not two segments', () => {
    expect(parseToken('?t=onlyonesegment')).toEqual({ mode: 'demo', reason: 'malformed' });
  });

  it.each(['endpoint', 'organization_id', 'member_id', 'meeting_id', 'exp'] as const)(
    'returns demo mode when %s claim is missing',
    (claim) => {
      const { [claim]: _omit, ...rest } = validClaims;
      const result = parseToken(`?t=${buildToken(rest)}`);
      expect(result).toEqual({ mode: 'demo', reason: 'missing-claim' });
    }
  );

  it('returns demo mode when endpoint is not https', () => {
    const result = parseToken(`?t=${buildToken({ ...validClaims, endpoint: 'http://insecure.test/x' })}`);
    expect(result).toEqual({ mode: 'demo', reason: 'missing-claim' });
  });

  it('returns demo mode when exp is in the past', () => {
    const result = parseToken(`?t=${buildToken({ ...validClaims, exp: 1 })}`);
    expect(result).toEqual({ mode: 'demo', reason: 'expired-locally' });
  });

  it('returns demo mode for a 3-segment token (real JWT, not our format)', () => {
    expect(parseToken('?t=a.b.c')).toEqual({ mode: 'demo', reason: 'malformed' });
  });

  it('returns demo mode when the payload segment is empty', () => {
    expect(parseToken('?t=.sig')).toEqual({ mode: 'demo', reason: 'malformed' });
  });
});
