/**
 * Stable failure codes for Proton Pass integration (machine-readable).
 * Never attach secret values to these errors.
 */

export const PASS_ERROR_CODES = [
  'PASS_CLI_MISSING',
  'SESSION_MISSING',
  'PAT_MISSING',
  'PAT_NO_VAULT',
  'ENV_FILE_MISSING',
  'URI_RESOLVE_FAIL',
  'URI_EMPTY_VALUE',
  'GATE_BLOCK',
  'CHILD_EXIT',
  'DESK_PROFILE_NULL',
] as const;

export type PassErrorCode = (typeof PASS_ERROR_CODES)[number];

export class PassError extends Error {
  readonly code: PassErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: PassErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'PassError';
    this.code = code;
    this.details = details;
  }
}

/** Redact free-form CLI stderr for logs (truncate; strip obvious tokens). */
export function redactErrorMessage(raw: string, maxLen = 120): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  // JWT-like / pst_ tokens
  s = s.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+\b/g, '[redacted-jwt]');
  s = s.replace(/\bpst_[A-Za-z0-9_:+/=.-]{8,}\b/g, '[redacted-pat]');
  s = s.replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]');
  if (s.length > maxLen) s = s.slice(0, maxLen) + '…';
  return s;
}
