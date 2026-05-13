import { formatPreflightError } from './formatPreflightError';

describe('formatPreflightError', () => {
  it('returns null when both errors are null', () => {
    expect(formatPreflightError(null, null)).toBeNull();
  });

  it('returns the regular preflight error message verbatim (no prefix) when only error is set', () => {
    expect(formatPreflightError(new Error('TURN unreachable'), null)).toBe('TURN unreachable');
  });

  it('returns Chronus-tagged string when only tokenError is set', () => {
    expect(formatPreflightError(null, new Error('token server expired'))).toBe(
      '[chronus] preflight token error: token server expired'
    );
  });

  it('prefers regular preflight error over tokenError when both are set (most-proximate failure wins)', () => {
    const err = new Error('preflight crashed');
    const tokenErr = new Error('token server expired');
    expect(formatPreflightError(err, tokenErr)).toBe('preflight crashed');
  });
});
