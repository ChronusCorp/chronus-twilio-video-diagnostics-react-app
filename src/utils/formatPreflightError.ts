/**
 * Coalesces preflight failure into a single error string. `error` (regular
 * preflight error) wins over `tokenError` so the more proximate failure
 * surfaces. tokenError gets a Chronus-prefixed tag so the backend (and humans
 * reading logs) can distinguish "TURN credentials expired" from "preflight
 * failed for other reasons".
 */
export function formatPreflightError(error: Error | null, tokenError: Error | null): string | null {
  if (error) return error.message;
  if (tokenError) return `[chronus] preflight token error: ${tokenError.message}`;
  return null;
}
