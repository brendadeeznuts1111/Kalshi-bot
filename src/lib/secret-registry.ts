/**
 * secret-registry.ts - the SINGLE source of truth for credential names (S218).
 *
 * 'Why is our security not secret and defined?' - the gap was: secret names
 * were raw strings scattered across modules (kalshi-auth.ts, the secrets CLI),
 * and the CLI accepted a PLAINTEXT PEM via --key-secret (visible in the
 * process list / ps). This registry types every secret and its POLICY:
 *   - env:   may come from env vars
 *   - vault: may come from the OS keychain
 *   - argv:  may NEVER be passed on the command line (process-list leak)
 * and provides the leak-scan used by the CLI + tests.
 */
export type SecretSource = 'env' | 'vault' | 'argv';

export interface SecretPolicy {
  /** Application/service namespace (Bun.secrets object form, S215). */
  service: string;
  /** Account name within the service (keychain). */
  name: string;
  /** Env var name (fallback source), if allowed. */
  envName?: string;
  /** Which sources are ALLOWED for this secret. */
  sources: SecretSource[];
  /** Human purpose (docs + audit). */
  purpose: string;
}

export const DEFAULT_SECRET_SERVICE = 'com.kalshi-bot';

/**
 * Registry of every credential this repo knows. Add a secret here, never
 * reference a raw name elsewhere. KALSHI keys are vault+env ONLY - argv is
 * forbidden (plaintext in ps).
 */
export const SECRET_REGISTRY: Record<string, SecretPolicy> = {
  'kalshi-api-key-id': {
    service: DEFAULT_SECRET_SERVICE,
    name: 'kalshi-api-key-id',
    envName: 'KALSHI_API_KEY_ID',
    sources: ['vault', 'env'],
    purpose: 'Kalshi API key id (RSA-PSS REST/WS signing identity)',
  },
  'kalshi-private-key': {
    service: DEFAULT_SECRET_SERVICE,
    name: 'kalshi-private-key',
    envName: 'KALSHI_PRIVATE_KEY',
    sources: ['vault', 'env'],
    purpose: 'Kalshi RSA-PSS private key (PEM)',
  },
  'watermark-mldsa-key': {
    service: DEFAULT_SECRET_SERVICE,
    name: 'watermark-mldsa-key',
    envName: 'WATERMARK_MLDSA_PRIVATE_KEY',
    sources: ['vault', 'env'],
    purpose: 'Persistent ML-DSA-65 watermark signing key (PNG provenance, S220)',
  },
  'mlkem-private-key': {
    service: DEFAULT_SECRET_SERVICE,
    name: 'mlkem-private-key',
    envName: 'MLKEM_PRIVATE_KEY',
    sources: ['vault', 'env'],
    purpose: 'ML-KEM-768 post-quantum key-agreement private key (S223)',
  },
};

export type SecretName = keyof typeof SECRET_REGISTRY;

export function secretPolicy(name: SecretName): SecretPolicy {
  const p = SECRET_REGISTRY[name];
  if (!p) throw new Error('Unknown secret: ' + String(name) + ' - add it to SECRET_REGISTRY');
  return p;
}

/**
 * True when a secret may come from a given source. argv is only ever
 * allowed for secrets explicitly marked so (none today - process-list leak).
 */
export function secretAllows(policy: SecretPolicy, source: SecretSource): boolean {
  return policy.sources.includes(source);
}

/**
 * Leak scan: does the given argv mention a secret VALUE pattern that
 * should never be on the command line? Flags like --key-secret or
 * --secret=... carrying a value are process-list leaks. Returns the
 * offending tokens (without the values).
 */
export function argvSecretLeaks(argv: string[]): string[] {
  const leaks: string[] = [];
  for (const a of argv) {
    const m = /^--([a-z0-9-]*?(?:secret|key|token|password|pem|private)[a-z0-9-]*?)(?:=|\s|$)/i.exec(a);
    if (m) leaks.push('--' + m[1]);
  }
  return leaks;
}
