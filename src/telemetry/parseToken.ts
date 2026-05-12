import type { TelemetryMode, TokenClaims } from './types';

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return atob(padded + '='.repeat(padLen));
}

function isValidClaims(c: unknown): c is TokenClaims {
  if (typeof c !== 'object' || c === null) return false;
  const o = c as Record<string, unknown>;
  return (
    typeof o.endpoint === 'string' &&
    o.endpoint.startsWith('https://') &&
    typeof o.organization_id === 'number' &&
    typeof o.member_id === 'number' &&
    typeof o.meeting_id === 'number' &&
    typeof o.exp === 'number'
  );
}

export function parseToken(search: string): TelemetryMode {
  const params = new URLSearchParams(search);
  const raw = params.get('t');
  if (!raw) return { mode: 'demo', reason: 'no-token' };

  const parts = raw.split('.');
  if (parts.length !== 2) return { mode: 'demo', reason: 'malformed' };

  let claims: unknown;
  try {
    claims = JSON.parse(base64UrlDecode(parts[0]));
  } catch {
    return { mode: 'demo', reason: 'malformed' };
  }

  if (!isValidClaims(claims)) return { mode: 'demo', reason: 'missing-claim' };

  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) {
    return { mode: 'demo', reason: 'expired-locally' };
  }

  return { mode: 'post', endpoint: claims.endpoint, rawToken: raw, claims };
}
