import type { TelemetryMode, TokenClaims } from './types';

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return atob(padded + '='.repeat(padLen));
}

// Allows https:// in any environment, plus anything that parses as a URL when
// NODE_ENV === 'development' (so devs can point at local http backends).
// The dev branch is dead-code-eliminated from `npm run build` bundles.
function isAllowedEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === 'https:' || process.env.NODE_ENV === 'development';
}

type ClaimsValidation = { ok: true; claims: TokenClaims } | { ok: false; reasons: string[] };

function validateClaims(c: unknown): ClaimsValidation {
  if (typeof c !== 'object' || c === null) {
    return { ok: false, reasons: [`claims is not an object (got ${c === null ? 'null' : typeof c})`] };
  }
  const o = c as Record<string, unknown>;
  const reasons: string[] = [];

  if (typeof o.endpoint !== 'string') {
    reasons.push(`endpoint must be a string, got ${typeof o.endpoint}`);
  } else if (!isAllowedEndpoint(o.endpoint)) {
    reasons.push(`endpoint "${o.endpoint}" is not allowed (must be https:// or NODE_ENV must be 'development')`);
  }

  for (const field of ['organization_id', 'member_id', 'meeting_id', 'exp'] as const) {
    if (typeof o[field] !== 'number') {
      reasons.push(`${field} must be a number, got ${typeof o[field]}`);
    }
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, claims: o as unknown as TokenClaims };
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

  const validation = validateClaims(claims);
  if (!validation.ok) {
    console.warn(
      `[parseToken] claim validation failed (${validation.reasons.length} issue${
        validation.reasons.length === 1 ? '' : 's'
      }):\n  - ${validation.reasons.join('\n  - ')}`
    );
    return { mode: 'demo', reason: 'missing-claim' };
  }

  const validClaims = validation.claims;
  if (validClaims.exp * 1000 < Date.now()) {
    return { mode: 'demo', reason: 'expired-locally' };
  }

  return { mode: 'post', endpoint: validClaims.endpoint, rawToken: raw, claims: validClaims };
}
