/**
 * OS-keychain credential store wrapper over `Bun.secrets` (Bun 1.4).
 *
 * `Bun.secrets` is NOT automatic console redaction — it is Bun's bindings to
 * the operating system credential vault (macOS Keychain, Windows Credential
 * Manager, libsecret on Linux). Use it to move plaintext secrets out of
 * `.env` / key files and into the OS vault, then keep the existing
 * `redactSecrets` pipeline for output hygiene. The two are complementary:
 * store in the vault, redact on the way out.
 *
 * The wrapper is backend-injectable so tests can run against an in-memory
 * map; production defaults to the real keychain via `keychainBackend`.
 * Reads degrade to an env-var fallback when the vault misses or throws
 * (locked keychain, headless CI) — the same shape as Bun's documented
 * multi-source credential lookup.
 *
 * @see https://bun.com/docs/runtime/bun-secrets (Bun 1.4 secrets manager)
 * @see src/lib/redact.ts — output-side redaction; complementary, not a substitute
 */

export type SecretRef = {
  /** Application/service namespace, e.g. "com.kalshi-bot". */
  service: string;
  /** Account name or resource identifier within the service. */
  name: string;
};

export type SecretRefWithValue = SecretRef & {
  value: string;
  /**
   * macOS keychain only: allow all apps to read this item without user
   * interaction (CI use). Default false; ignored on other platforms.
   * @see https://bun.com/docs/runtime/secrets (set options)
   */
  allowUnrestrictedAccess?: boolean;
};

/** Injectable vault backend; tests substitute an in-memory map. */
export interface SecretBackend {
  get(ref: SecretRef): Promise<string | null>;
  set(ref: SecretRefWithValue): Promise<void>;
  /** Returns true when a credential was deleted, false if not found (per Bun docs). */
  delete(ref: SecretRef): Promise<boolean>;
}

/** Reverse-domain service namespace for this repo's credentials. */
export const DEFAULT_SECRET_SERVICE = "com.kalshi-bot";

/** Feature-detect the OS vault (absent on pre-1.4 runtimes). */
export function hasSecretBackend(): boolean {
  return typeof Bun !== "undefined" && typeof Bun.secrets !== "undefined";
}

/** Real keychain backend; set/delete throw when the vault is unavailable. */
export const keychainBackend: SecretBackend = {
  async get(ref) {
    if (!hasSecretBackend()) return null;
    return await Bun.secrets.get(ref);
  },
  async set(ref) {
    if (!hasSecretBackend()) {
      throw new Error("Bun.secrets unavailable — no OS credential store to write to");
    }
    await Bun.secrets.set(ref);
  },
  async delete(ref) {
    if (!hasSecretBackend()) return false;
    return await Bun.secrets.delete(ref);
  },
};

export type GetSecretOptions = {
  backend?: SecretBackend;
  /** Env var name to fall back to when the vault misses or is unavailable. */
  envName?: string;
  /** Env source; defaults to Bun.env. */
  env?: Record<string, string | undefined>;
};

/**
 * Read a credential: vault first, env fallback, then null.
 * Vault errors (locked keychain, headless CI) degrade to the env fallback
 * rather than crashing the caller.
 */
export async function getSecret(
  ref: SecretRef,
  opts: GetSecretOptions = {},
): Promise<string | null> {
  const backend = opts.backend ?? keychainBackend;
  try {
    const stored = await backend.get(ref);
    if (stored != null) return stored;
  } catch (err) {
    console.warn(
      "[secrets] vault read failed for " + ref.service + "/" + ref.name +
        ": " + (err as Error).message,
    );
  }
  if (opts.envName) {
    const source = opts.env ?? (Bun.env);
    const fromEnv = source[opts.envName]?.trim();
    if (fromEnv) return fromEnv;
  }
  return null;
}

/**
 * Store or replace a credential in the vault.
 *
 * Docs semantics: an empty `value` deletes the credential if it exists
 * (same as `deleteSecret`), and `allowUnrestrictedAccess` skips the macOS
 * keychain prompt for CI runs. The object form is the typed primary API —
 * Bun's positional forms (`secrets.set('app','name',value)`) work at
 * runtime but bun-types 1.4.0 does not declare them.
 */
export async function setSecret(
  ref: SecretRefWithValue,
  backend: SecretBackend = keychainBackend,
): Promise<void> {
  await backend.set(ref);
}

/** Remove a credential from the vault (no-op when the vault is unavailable). */
export async function deleteSecret(
  ref: SecretRef,
  backend: SecretBackend = keychainBackend,
): Promise<void> {
  await backend.delete(ref);
}
