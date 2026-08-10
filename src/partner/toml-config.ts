/**
 * Partner domain config via Bun.TOML (v1.1) — non-secret registry SSOT on disk.
 *
 * Secrets stay in env / Proton Pass (env_prefix + vault_id pointers only).
 *
 * ## What --seed does
 * Upserts into SQLite tables `partners` + `betting_accounts` (skins live in
 * `meta_json`, not a separate skins table). Capacity is **computed at read time**
 * by `computeProviderCapacity` — no denormalized capacity_cache (by design).
 *
 * ## What --diff / --dry-run do
 * Compare materialized TOML against current DB rows (add/change/remove-orphan).
 * `--dry-run` prints the same plan and never writes. Seed does not delete orphans.
 *
 * ## Env resolution precedence (per out)
 *   1. out prefix     e.g. FANTASY402_SPEN_1_BEARER_TOKEN
 *   2. partner prefix e.g. FANTASY402_SPEN_BEARER_TOKEN
 *   3. book fallback  e.g. FANTASY402_BEARER_TOKEN
 *   4. desk URL       PARTNER_DOMAIN → SKINS Ultra-mapper default (host → SkinId)
 *
 * Canonical env_prefix: `{BOOK}_{CODE}_{N}_` from out id `out-SPEN-1`.
 *
 * @see https://bun.com/docs/runtime/toml
 * @see https://bun.com/docs/api/utils#bun-toml
 */
// @see https://bun.com/docs/runtime/toml
import type { Database } from 'bun:sqlite';
import { z } from 'zod';
import {
  PARTNER_DOMAIN_ENV,
  isRetiredBareBookDomainEnv,
  requireDefaultUrlForUltraMapper,
} from '../domain/index.ts';
import {
  ensurePartnerRegistrySchema,
  upsertBettingAccount,
  upsertPartner,
  type BettingAccountRow,
  type PartnerEntity,
} from './registry.ts';
import { buildSkinsMeta, type OutSkinLimit } from './skins.ts';
import { getPartnerVisual } from './visuals.ts';
import { tomlStringify } from './toml-stringify.ts';

export { PARTNER_DOMAIN_ENV, resolveDeskDomainFromEnv } from '../domain/index.ts';

export const DEFAULT_PARTNERS_TOML = 'config/partners.toml';
export const EXAMPLE_PARTNERS_TOML = 'config/partners.example.toml';

/** Coerce TOML numbers that sometimes arrive as strings after edits. */
const zNum = z.coerce.number().finite();

const partnersTomlSkinSchema = z
  .object({
    name: z.string().min(1),
    per_bet_max: zNum.optional(),
    perBetMax: zNum.optional(),
    max_win: zNum.optional(),
    maxWin: zNum.optional(),
    active: z.boolean().optional(),
  })
  .passthrough();

const partnersTomlOutSchema = z
  .object({
    id: z.string().min(1),
    partner_code: z.string().optional(),
    partnerCode: z.string().optional(),
    provider: z.string().optional(),
    env_prefix: z.string().optional(),
    envPrefix: z.string().optional(),
    currency: z.string().optional(),
    url: z.string().optional(),
    working_balance: zNum.optional(),
    workingBalance: zNum.optional(),
    vault_id: z.string().optional(),
    vaultId: z.string().optional(),
    status: z.enum(['active', 'inactive', 'pending']).or(z.string()).optional(),
    skins: z.array(partnersTomlSkinSchema).optional(),
  })
  .passthrough();

const partnersTomlPartnerSchema = z
  .object({
    code: z.string().min(1),
    id: z.string().optional(),
    name: z.string().optional(),
    active: z.boolean().optional(),
    profit_split: zNum.optional(),
    profitSplit: zNum.optional(),
    commission_rate: zNum.optional(),
    commissionRate: zNum.optional(),
    notes: z.string().optional(),
    telegram_chat_id: z.string().optional(),
    telegramChatId: z.string().optional(),
  })
  .passthrough();

export const partnersTomlDocSchema = z
  .object({
    version: zNum.optional(),
    title: z.string().optional(),
    partners: z.array(partnersTomlPartnerSchema).optional(),
    outs: z.array(partnersTomlOutSchema).optional(),
  })
  .passthrough();

export type PartnersTomlSkin = z.infer<typeof partnersTomlSkinSchema>;
export type PartnersTomlOut = z.infer<typeof partnersTomlOutSchema>;
export type PartnersTomlPartner = z.infer<typeof partnersTomlPartnerSchema>;
export type PartnersTomlDoc = z.infer<typeof partnersTomlDocSchema>;

export type PartnersTomlLoadResult = {
  path: string;
  doc: PartnersTomlDoc;
  partners: PartnerEntity[];
  accounts: BettingAccountRow[];
};

/** Credential field suffixes used with env_prefix (no secret values). */
export const PARTNER_ENV_KEYS = [
  'BEARER_TOKEN',
  'CUSTOMER_ID',
  'AGENT_ID',
  'PASSWORD',
  'DOMAIN',
  'SKIN',
  'CURRENCY',
] as const;

export type PartnerEnvKey = (typeof PARTNER_ENV_KEYS)[number];

export type PartnerEnvSource = 'out' | 'partner' | 'book_fallback';

export type PartnerEnvBundle = {
  envPrefix: string;
  /** Resolved values; missing keys omitted (never empty forge). */
  values: Partial<Record<PartnerEnvKey, string>>;
  /** Which source won per key */
  source: Partial<Record<PartnerEnvKey, PartnerEnvSource>>;
};

/** Keys required for Fantasy Ultra session (soft default for --check-env). */
export const DEFAULT_REQUIRED_ENV_KEYS: readonly PartnerEnvKey[] = [
  'BEARER_TOKEN',
  'CUSTOMER_ID',
  'AGENT_ID',
  'PASSWORD',
];

/** Parse `out-SPEN-1` → { code: "SPEN", index: "1" }. */
export function parseOutId(outId: string): { code: string; index: string } | null {
  const m = /^out-([A-Za-z0-9]+)-(\d+)$/.exec(outId.trim());
  if (!m) return null;
  return { code: m[1]!.toUpperCase(), index: m[2]! };
}

/** Normalize env prefix to trailing underscore form. */
export function normalizeEnvPrefix(prefix: string): string {
  const t = prefix.trim().toUpperCase().replace(/_+$/, '');
  return t ? `${t}_` : 'FANTASY402_';
}

function bookToken(provider: string): string {
  return (
    (provider.trim() || 'fantasy402')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'FANTASY402'
  );
}

/**
 * Partner-level prefix (shared across outs of the same partner).
 *   fantasy402 + SPEN → FANTASY402_SPEN_
 */
export function canonicalPartnerEnvPrefix(provider: string, partnerCode: string): string {
  const book = bookToken(provider);
  const code = partnerCode
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!code) return `${book}_`;
  return `${book}_${code}_`;
}

/**
 * Per-out prefix (preferred for secrets).
 *   fantasy402 + out-SPEN-3 → FANTASY402_SPEN_3_
 */
export function canonicalOutEnvPrefix(
  provider: string,
  outId: string,
  partnerCode?: string
): string {
  const parsed = parseOutId(outId);
  const code =
    partnerCode
      ?.trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '') ||
    parsed?.code ||
    '';
  const index = parsed?.index;
  const book = bookToken(provider);
  if (code && index) return `${book}_${code}_${index}_`;
  if (code) return `${book}_${code}_`;
  return `${book}_`;
}

/** `vault-{outId}` — outId already carries partner code (`out-SPEN-1`). */
export function canonicalVaultId(outId: string): string {
  const id = outId.trim();
  if (!id) return 'vault-unknown';
  return id.startsWith('vault-') ? id : `vault-${id}`;
}

/** True when prefix is only the book family (no partner code segment). */
export function isBareBookEnvPrefix(prefix: string, provider = 'fantasy402'): boolean {
  const n = normalizeEnvPrefix(prefix);
  const bare = canonicalPartnerEnvPrefix(provider, '');
  return n === bare;
}

/** True when prefix embeds `_{PARTNER}_` (partner- or out-scoped). */
export function isPartnerScopedEnvPrefix(prefix: string, partnerCode: string): boolean {
  const code = partnerCode
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!code) return false;
  const n = normalizeEnvPrefix(prefix);
  return n.includes(`_${code}_`);
}

/** True when prefix is exactly per-out: `{BOOK}_{CODE}_{N}_`. */
export function isOutScopedEnvPrefix(
  prefix: string,
  outId: string,
  provider = 'fantasy402'
): boolean {
  const want = canonicalOutEnvPrefix(provider, outId);
  return normalizeEnvPrefix(prefix) === want;
}

/**
 * Resolution chain for an out prefix:
 *   FANTASY402_SPEN_1_ → FANTASY402_SPEN_ → FANTASY402_
 */
export function envPrefixFallbackChain(
  envPrefix: string,
  provider = 'fantasy402'
): Array<{ prefix: string; source: PartnerEnvSource }> {
  const out = normalizeEnvPrefix(envPrefix);
  const chain: Array<{ prefix: string; source: PartnerEnvSource }> = [
    { prefix: out, source: 'out' },
  ];
  // Strip trailing out index: FANTASY402_SPEN_1_ → FANTASY402_SPEN_
  const partner = out.replace(/_(\d+)_$/, '_');
  if (partner !== out) {
    chain.push({ prefix: partner, source: 'partner' });
  }
  const book = canonicalPartnerEnvPrefix(provider, '');
  if (!chain.some(c => c.prefix === book)) {
    chain.push({ prefix: book, source: 'book_fallback' });
  }
  // Fantasy book alias when provider slug differs but still fantasy402 family
  if (book !== 'FANTASY402_' && !chain.some(c => c.prefix === 'FANTASY402_')) {
    chain.push({ prefix: 'FANTASY402_', source: 'book_fallback' });
  }
  return chain;
}

export type PartnerAssetIssue = {
  outId: string;
  partnerCode: string;
  field: 'env_prefix' | 'vault_id' | 'out_id';
  message: string;
  expected?: string;
  actual?: string;
};

/**
 * Ensure every out's assets are partner-prefixed (env + vault + out id).
 * Returns issues (empty = ok). Does not write.
 */
export function validatePartnerAssetPrefixes(doc: PartnersTomlDoc): PartnerAssetIssue[] {
  const { accounts } = materializePartnersToml(doc);
  const issues: PartnerAssetIssue[] = [];
  for (const a of accounts) {
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(a.metaJson || '{}') as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    const partnerCode = String(meta.partnerCode ?? '')
      .trim()
      .toUpperCase();
    const codeFromOut = /^out-([A-Z0-9]+)-/i.exec(a.id)?.[1]?.toUpperCase();
    const code = partnerCode || codeFromOut || '';

    if (code && !new RegExp(`^out-${code}-`, 'i').test(a.id)) {
      issues.push({
        outId: a.id,
        partnerCode: code,
        field: 'out_id',
        message: `out id should start with out-${code}-`,
        expected: `out-${code}-N`,
        actual: a.id,
      });
    }

    const prefix = a.envPrefix ?? '';
    const wantOut = canonicalOutEnvPrefix(a.provider, a.id, code);
    if (!code) {
      issues.push({
        outId: a.id,
        partnerCode: '',
        field: 'env_prefix',
        message: 'missing partner_code — cannot scope env_prefix',
        actual: prefix,
      });
    } else if (!isOutScopedEnvPrefix(prefix, a.id, a.provider)) {
      issues.push({
        outId: a.id,
        partnerCode: code,
        field: 'env_prefix',
        message: 'env_prefix should be per-out {BOOK}_{CODE}_{N}_',
        expected: wantOut,
        actual: prefix,
      });
    }

    const vaultId = typeof meta.vaultId === 'string' ? meta.vaultId.trim() : '';
    const wantVault = canonicalVaultId(a.id);
    if (!vaultId) {
      issues.push({
        outId: a.id,
        partnerCode: code,
        field: 'vault_id',
        message: 'vault_id missing',
        expected: wantVault,
      });
    } else if (code && !vaultId.toUpperCase().includes(code)) {
      issues.push({
        outId: a.id,
        partnerCode: code,
        field: 'vault_id',
        message: 'vault_id should include partner code',
        expected: wantVault,
        actual: vaultId,
      });
    }
  }
  return issues;
}

export function formatPartnerAssetIssues(issues: PartnerAssetIssue[]): string {
  if (issues.length === 0) return 'assets: ok (partner-scoped prefixes)';
  const lines = [`assets: ${issues.length} issue(s)`];
  for (const i of issues) {
    lines.push(
      `  ✗ ${i.outId}  ${i.field}: ${i.message}` +
        (i.expected ? `  expected=${i.expected}` : '') +
        (i.actual ? `  actual=${i.actual}` : '')
    );
  }
  return lines.join('\n');
}

/**
 * Resolve secrets for an out:
 *   out prefix → partner prefix → book fallback
 *
 * DOMAIN is host→SkinId territory: per-out/partner `*DOMAIN` still wins;
 * book-level uses PARTNER_DOMAIN only (retired bare-book DOMAIN envs ignored).
 */
export function resolvePartnerEnv(
  envPrefix: string | null | undefined,
  envMap: Record<string, string | undefined> = process.env,
  keys: readonly PartnerEnvKey[] = PARTNER_ENV_KEYS,
  options?: { provider?: string }
): PartnerEnvBundle {
  const provider = options?.provider ?? 'fantasy402';
  const normalized = envPrefix?.trim() ? normalizeEnvPrefix(envPrefix) : 'FANTASY402_';
  const chain = envPrefixFallbackChain(normalized, provider);
  const values: PartnerEnvBundle['values'] = {};
  const source: PartnerEnvBundle['source'] = {};
  for (const key of keys) {
    for (const step of chain) {
      const envKey = `${step.prefix}${key}`;
      // Bare book prefix is often labeled source "out" when callers pass FANTASY402_
      // itself — still never read retired bare-book DOMAIN; only PARTNER_DOMAIN.
      const bookLevelDomain =
        key === 'DOMAIN' &&
        (step.source === 'book_fallback' ||
          isBareBookEnvPrefix(step.prefix, provider) ||
          isRetiredBareBookDomainEnv(envKey));
      if (bookLevelDomain) {
        const preferred = envMap[PARTNER_DOMAIN_ENV]?.trim();
        if (preferred) {
          values.DOMAIN = preferred;
          source.DOMAIN = 'book_fallback';
        }
        break;
      }
      if (isRetiredBareBookDomainEnv(envKey)) continue;
      const v = envMap[envKey]?.trim();
      if (v) {
        values[key] = v;
        source[key] = step.source;
        break;
      }
    }
    if (key === 'DOMAIN' && !values.DOMAIN) {
      const preferred = envMap[PARTNER_DOMAIN_ENV]?.trim();
      if (preferred) {
        values.DOMAIN = preferred;
        source.DOMAIN = 'book_fallback';
      }
    }
  }
  return { envPrefix: normalized, values, source };
}

/** Presence-only check for ops (no secret echo). */
export function partnerEnvPresence(
  bundle: PartnerEnvBundle
): Record<PartnerEnvKey, { present: boolean; source?: string }> {
  const out = {} as Record<PartnerEnvKey, { present: boolean; source?: string }>;
  for (const key of PARTNER_ENV_KEYS) {
    out[key] = {
      present: Boolean(bundle.values[key]),
      source: bundle.source[key],
    };
  }
  return out;
}

function asFiniteNumber(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseSkin(row: PartnersTomlSkin): OutSkinLimit | null {
  const name = String(row.name ?? '').trim();
  if (!name) return null;
  return {
    name,
    perBetMax: asFiniteNumber(row.per_bet_max ?? row.perBetMax, 0),
    maxWin: asFiniteNumber(row.max_win ?? row.maxWin, 0),
    active: row.active !== false,
  };
}

/**
 * Parse TOML text → partner domain doc.
 * Throws SyntaxError on invalid TOML; Error on shape failures.
 */
export function parsePartnersToml(text: string): PartnersTomlDoc {
  let raw: unknown;
  try {
    raw = Bun.TOML.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new SyntaxError(`partners TOML parse failed: ${msg}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SyntaxError('partners TOML: document must be a table');
  }
  const result = partnersTomlDocSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 8)
      .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`partners TOML schema: ${detail}`);
  }
  return result.data;
}

/** Serialize domain doc → TOML string. */
export function stringifyPartnersToml(doc: PartnersTomlDoc): string {
  const clean = JSON.parse(JSON.stringify(doc)) as PartnersTomlDoc;
  return tomlStringify(clean);
}

/** Map TOML partners/outs → registry rows (no DB writes). */
export function materializePartnersToml(doc: PartnersTomlDoc): {
  partners: PartnerEntity[];
  accounts: BettingAccountRow[];
} {
  const partners: PartnerEntity[] = [];
  const byCode = new Map<string, PartnerEntity>();

  for (const p of doc.partners ?? []) {
    const code = String(p.code ?? '')
      .trim()
      .toUpperCase();
    if (!code) continue;
    const id = String(p.id ?? '').trim() || `partner-${code.toLowerCase()}`;
    const noteParts: string[] = [];
    if (p.notes?.trim()) noteParts.push(p.notes.trim());
    const tg = p.telegram_chat_id ?? p.telegramChatId;
    if (tg) noteParts.push(`telegram_chat_id=${tg}`);
    const entity: PartnerEntity = {
      id,
      name: String(p.name ?? `Partner ${code}`).trim(),
      active: p.active !== false,
      profitSplit:
        p.profit_split != null || p.profitSplit != null
          ? asFiniteNumber(p.profit_split ?? p.profitSplit, 0)
          : null,
      commissionRate:
        p.commission_rate != null || p.commissionRate != null
          ? asFiniteNumber(p.commission_rate ?? p.commissionRate, 0)
          : null,
      notes: noteParts.length ? noteParts.join('; ') : null,
    };
    partners.push(entity);
    byCode.set(code, entity);
  }

  const accounts: BettingAccountRow[] = [];
  for (const o of doc.outs ?? []) {
    const id = String(o.id ?? '').trim();
    if (!id) continue;
    const partnerCode = String(o.partner_code ?? o.partnerCode ?? '')
      .trim()
      .toUpperCase();
    let partner = partnerCode ? byCode.get(partnerCode) : undefined;
    if (!partner && partnerCode) {
      partner = {
        id: `partner-${partnerCode.toLowerCase()}`,
        name: `Partner ${partnerCode}`,
        active: true,
        profitSplit: null,
        commissionRate: null,
        notes: 'auto from out.partner_code',
      };
      partners.push(partner);
      byCode.set(partnerCode, partner);
    }
    if (!partner) {
      partner = {
        id: 'partner-default',
        name: 'Default Partner',
        active: true,
        profitSplit: null,
        commissionRate: null,
        notes: null,
      };
      if (!byCode.has('')) {
        partners.push(partner);
        byCode.set('', partner);
      }
    }

    const skins = (o.skins ?? []).map(parseSkin).filter((s): s is OutSkinLimit => s != null);
    const fallbackSkins: OutSkinLimit[] =
      skins.length > 0 ? skins : [{ name: '2', perBetMax: 0, maxWin: 0, active: true }];
    const maxStake = Math.max(...fallbackSkins.map(s => s.perBetMax), 0);
    const maxWin = Math.max(...fallbackSkins.map(s => s.maxWin), 0);
    const statusRaw = String(o.status ?? 'active').toLowerCase();
    const status =
      statusRaw === 'inactive' || statusRaw === 'pending'
        ? (statusRaw as BettingAccountRow['status'])
        : 'active';

    const provider = String(o.provider ?? 'fantasy402');
    // Per-out assets: FANTASY402_SPEN_1_ (upgrade bare book / partner-only prefixes)
    const rawPrefix = String(o.env_prefix ?? o.envPrefix ?? '').trim();
    const wantOut = canonicalOutEnvPrefix(provider, id, partnerCode);
    const partnerOnly =
      partnerCode &&
      normalizeEnvPrefix(rawPrefix) === canonicalPartnerEnvPrefix(provider, partnerCode);
    const envPrefix =
      !rawPrefix || (partnerCode && isBareBookEnvPrefix(rawPrefix, provider)) || partnerOnly
        ? wantOut
        : normalizeEnvPrefix(rawPrefix);
    const vaultId = String(o.vault_id ?? o.vaultId ?? '').trim() || canonicalVaultId(id);

    accounts.push({
      id,
      partnerId: partner.id,
      provider,
      url: String(o.url ?? requireDefaultUrlForUltraMapper()),
      status,
      envPrefix,
      maxStake,
      maxWin,
      currency: String(o.currency ?? 'USD'),
      skin: null,
      metaJson: buildSkinsMeta({
        skins: fallbackSkins,
        workingBalance:
          o.working_balance != null || o.workingBalance != null
            ? asFiniteNumber(o.working_balance ?? o.workingBalance)
            : undefined,
        vaultId,
        partnerCode: partnerCode || undefined,
        defaultSkin: fallbackSkins[0]?.name,
      }),
    });
  }

  return { partners, accounts };
}

export async function loadPartnersTomlFile(path: string): Promise<PartnersTomlLoadResult> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`partners TOML not found: ${path}`);
  }
  const text = await file.text();
  const doc = parsePartnersToml(text);
  const { partners, accounts } = materializePartnersToml(doc);
  return { path, doc, partners, accounts };
}

/** Upsert all partners + outs from TOML into the registry DB. */
export function seedRegistryFromPartnersToml(
  db: Database,
  doc: PartnersTomlDoc,
  nowMs = Date.now()
): { partners: number; accounts: number } {
  ensurePartnerRegistrySchema(db);
  const { partners, accounts } = materializePartnersToml(doc);
  for (const p of partners) upsertPartner(db, p, nowMs);
  for (const a of accounts) upsertBettingAccount(db, a, nowMs);
  return { partners: partners.length, accounts: accounts.length };
}

// ── Diff / dry-run / env presence ─────────────────────────────────────

export type RegistrySnapshot = {
  partners: PartnerEntity[];
  accounts: BettingAccountRow[];
};

export type FieldChange = { field: string; from: unknown; to: unknown };

export type DiffEntry =
  | { kind: 'add'; entity: 'partner' | 'out'; id: string; summary: string }
  | { kind: 'remove'; entity: 'partner' | 'out'; id: string; summary: string }
  | {
      kind: 'change';
      entity: 'partner' | 'out';
      id: string;
      changes: FieldChange[];
    };

export type PartnersTomlDiff = {
  entries: DiffEntry[];
  added: number;
  changed: number;
  removed: number;
  unchangedPartners: number;
  unchangedOuts: number;
};

export type EnvPresenceReport = {
  outs: Array<{
    outId: string;
    envPrefix: string;
    missing: PartnerEnvKey[];
    present: PartnerEnvKey[];
    sources: PartnerEnvBundle['source'];
  }>;
  missingCount: number;
  ok: boolean;
};

export function loadRegistrySnapshot(db: Database): RegistrySnapshot {
  ensurePartnerRegistrySchema(db);
  const partners = db
    .query(
      `SELECT id, name, active, profit_split AS profitSplit,
              commission_rate AS commissionRate, notes
       FROM partners`
    )
    .all() as Array<{
    id: string;
    name: string;
    active: number;
    profitSplit: number | null;
    commissionRate: number | null;
    notes: string | null;
  }>;
  const accounts = db
    .query(
      `SELECT id, partner_id AS partnerId, provider, url, status,
              env_prefix AS envPrefix, max_stake AS maxStake, max_win AS maxWin,
              currency, skin, meta_json AS metaJson
       FROM betting_accounts`
    )
    .all() as Array<Record<string, unknown>>;

  return {
    partners: partners.map(p => ({
      id: p.id,
      name: p.name,
      active: Boolean(p.active),
      profitSplit: p.profitSplit,
      commissionRate: p.commissionRate,
      notes: p.notes,
    })),
    accounts: accounts.map(r => ({
      id: String(r.id),
      partnerId: String(r.partnerId),
      provider: String(r.provider),
      url: String(r.url ?? ''),
      status: String(r.status ?? 'active') as BettingAccountRow['status'],
      envPrefix: r.envPrefix != null ? String(r.envPrefix) : null,
      maxStake: Number(r.maxStake) || 0,
      maxWin: Number(r.maxWin) || 0,
      currency: String(r.currency ?? 'USD'),
      skin: r.skin == null ? null : Number(r.skin),
      metaJson: String(r.metaJson ?? '{}'),
    })),
  };
}

function partnerSig(p: PartnerEntity): Record<string, unknown> {
  return {
    name: p.name,
    active: p.active,
    profitSplit: p.profitSplit,
    commissionRate: p.commissionRate,
    notes: p.notes,
  };
}

function outSig(a: BettingAccountRow): Record<string, unknown> {
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(a.metaJson || '{}') as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return {
    partnerId: a.partnerId,
    provider: a.provider,
    url: a.url,
    status: a.status,
    envPrefix: a.envPrefix,
    maxStake: a.maxStake,
    maxWin: a.maxWin,
    currency: a.currency,
    skins: meta.skins ?? null,
    workingBalance: meta.workingBalance ?? null,
    vaultId: meta.vaultId ?? null,
    partnerCode: meta.partnerCode ?? null,
  };
}

function diffObjects(from: Record<string, unknown>, to: Record<string, unknown>): FieldChange[] {
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  const changes: FieldChange[] = [];
  for (const k of [...keys].sort()) {
    const a = from[k];
    const b = to[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push({ field: k, from: a, to: b });
    }
  }
  return changes;
}

/**
 * Compare TOML-materialized registry vs current DB rows.
 * Does not write. Used by --diff and --dry-run.
 */
export function diffPartnersTomlVsDb(doc: PartnersTomlDoc, db: Database): PartnersTomlDiff {
  ensurePartnerRegistrySchema(db);
  const desired = materializePartnersToml(doc);
  const current = loadRegistrySnapshot(db);

  const curPartners = new Map(current.partners.map(p => [p.id, p]));
  const curAccounts = new Map(current.accounts.map(a => [a.id, a]));
  const wantPartners = new Map(desired.partners.map(p => [p.id, p]));
  const wantAccounts = new Map(desired.accounts.map(a => [a.id, a]));

  const entries: DiffEntry[] = [];
  let unchangedPartners = 0;
  let unchangedOuts = 0;

  for (const [id, p] of wantPartners) {
    const cur = curPartners.get(id);
    if (!cur) {
      entries.push({
        kind: 'add',
        entity: 'partner',
        id,
        summary: p.name,
      });
      continue;
    }
    const changes = diffObjects(partnerSig(cur), partnerSig(p));
    if (changes.length) {
      entries.push({ kind: 'change', entity: 'partner', id, changes });
    } else {
      unchangedPartners++;
    }
  }
  for (const [id, p] of curPartners) {
    if (!wantPartners.has(id)) {
      entries.push({
        kind: 'remove',
        entity: 'partner',
        id,
        summary: `${p.name} (in DB only — seed does not delete)`,
      });
    }
  }

  for (const [id, a] of wantAccounts) {
    const cur = curAccounts.get(id);
    if (!cur) {
      entries.push({
        kind: 'add',
        entity: 'out',
        id,
        summary: `${a.provider} maxStake=${a.maxStake}`,
      });
      continue;
    }
    const changes = diffObjects(outSig(cur), outSig(a));
    if (changes.length) {
      entries.push({ kind: 'change', entity: 'out', id, changes });
    } else {
      unchangedOuts++;
    }
  }
  for (const [id, a] of curAccounts) {
    if (!wantAccounts.has(id)) {
      entries.push({
        kind: 'remove',
        entity: 'out',
        id,
        summary: `${a.provider} maxStake=${a.maxStake} (in DB only — seed does not delete)`,
      });
    }
  }

  entries.sort((a, b) => {
    const order = { add: 0, change: 1, remove: 2 };
    return (
      order[a.kind] - order[b.kind] || a.entity.localeCompare(b.entity) || a.id.localeCompare(b.id)
    );
  });

  return {
    entries,
    added: entries.filter(e => e.kind === 'add').length,
    changed: entries.filter(e => e.kind === 'change').length,
    removed: entries.filter(e => e.kind === 'remove').length,
    unchangedPartners,
    unchangedOuts,
  };
}

/** Check whether required secret env keys resolve for each out (no secret values returned). */
export function checkPartnersEnvPresence(
  accounts: BettingAccountRow[],
  options?: {
    envMap?: Record<string, string | undefined>;
    requiredKeys?: readonly PartnerEnvKey[];
  }
): EnvPresenceReport {
  const required = options?.requiredKeys ?? DEFAULT_REQUIRED_ENV_KEYS;
  const envMap = options?.envMap ?? process.env;
  const outs = accounts.map(a => {
    const bundle = resolvePartnerEnv(a.envPrefix, envMap);
    const missing = required.filter(k => !bundle.values[k]);
    const present = required.filter(k => Boolean(bundle.values[k]));
    return {
      outId: a.id,
      envPrefix: bundle.envPrefix,
      missing,
      present,
      sources: bundle.source,
    };
  });
  const missingCount = outs.reduce((n, o) => n + o.missing.length, 0);
  return { outs, missingCount, ok: missingCount === 0 };
}

export function formatPartnersDiffText(diff: PartnersTomlDiff): string {
  const lines: string[] = [];
  lines.push(
    `diff: +${diff.added} ~${diff.changed} -${diff.removed}  (unchanged partners=${diff.unchangedPartners} outs=${diff.unchangedOuts})`
  );
  for (const e of diff.entries) {
    if (e.kind === 'add') {
      lines.push(`  + ${e.entity} ${e.id}  ${e.summary}`);
    } else if (e.kind === 'remove') {
      lines.push(`  - ${e.entity} ${e.id}  ${e.summary}`);
    } else {
      lines.push(`  ~ ${e.entity} ${e.id}`);
      for (const c of e.changes.slice(0, 12)) {
        const from = typeof c.from === 'object' ? JSON.stringify(c.from) : String(c.from);
        const to = typeof c.to === 'object' ? JSON.stringify(c.to) : String(c.to);
        lines.push(`      ${c.field}: ${from.slice(0, 80)} → ${to.slice(0, 80)}`);
      }
      if (e.changes.length > 12) {
        lines.push(`      … +${e.changes.length - 12} more fields`);
      }
    }
  }
  if (diff.entries.length === 0) {
    lines.push('  (no changes)');
  }
  return lines.join('\n');
}

export function formatEnvPresenceText(report: EnvPresenceReport): string {
  const lines: string[] = [
    `env check: ${report.ok ? 'ok' : 'MISSING keys'}  (gaps=${report.missingCount})`,
  ];
  for (const o of report.outs) {
    if (o.missing.length === 0) {
      lines.push(`  ✓ ${o.outId}  prefix=${o.envPrefix}  all required present`);
    } else {
      lines.push(`  ✗ ${o.outId}  prefix=${o.envPrefix}  missing: ${o.missing.join(', ')}`);
    }
  }
  return lines.join('\n');
}

/**
 * Export current registry-shaped data to TOML (for round-trip / git ops).
 * Visuals section is derived, not stored as secrets.
 */
export function buildPartnersTomlFromRows(
  partners: PartnerEntity[],
  accounts: BettingAccountRow[],
  meta?: { title?: string }
): PartnersTomlDoc {
  const codeByPartnerId = new Map<string, string>();
  const tomlPartners: PartnersTomlPartner[] = partners.map(p => {
    const codeGuess = p.id.replace(/^partner-/i, '').toUpperCase() || p.id.toUpperCase();
    codeByPartnerId.set(p.id, codeGuess);
    return {
      code: codeGuess,
      id: p.id,
      name: p.name,
      active: p.active,
      ...(p.profitSplit != null ? { profit_split: p.profitSplit } : {}),
      ...(p.commissionRate != null ? { commission_rate: p.commissionRate } : {}),
      ...(p.notes ? { notes: p.notes } : {}),
    };
  });

  const outs: PartnersTomlOut[] = accounts.map(a => {
    let rowMeta: Record<string, unknown> = {};
    try {
      rowMeta = JSON.parse(a.metaJson || '{}') as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    const partnerCode =
      String(rowMeta.partnerCode ?? codeByPartnerId.get(a.partnerId) ?? '').toUpperCase() ||
      undefined;
    const skinsRaw = Array.isArray(rowMeta.skins) ? rowMeta.skins : [];
    const skins: PartnersTomlSkin[] = skinsRaw.flatMap(s => {
      if (!s || typeof s !== 'object') return [];
      const r = s as Record<string, unknown>;
      const name = String(r.name ?? r.skin ?? '').trim();
      if (!name) return [];
      return [
        {
          name,
          per_bet_max: asFiniteNumber(r.perBetMax ?? r.per_bet_max, 0),
          max_win: asFiniteNumber(r.maxWin ?? r.max_win, 0),
          active: r.active !== false,
        },
      ];
    });

    return {
      id: a.id,
      partner_code: partnerCode,
      provider: a.provider,
      env_prefix: a.envPrefix ?? undefined,
      currency: a.currency,
      url: a.url || undefined,
      working_balance:
        typeof rowMeta.workingBalance === 'number' ? rowMeta.workingBalance : undefined,
      vault_id: typeof rowMeta.vaultId === 'string' ? rowMeta.vaultId : undefined,
      status: a.status,
      skins:
        skins.length > 0
          ? skins
          : [
              {
                name: a.skin != null ? String(a.skin) : '2',
                per_bet_max: a.maxStake,
                max_win: a.maxWin,
                active: true,
              },
            ],
    };
  });

  return {
    version: 1,
    title: meta?.title ?? 'Kalshi-bot partner registry',
    partners: tomlPartners,
    outs,
  };
}

/** Attach computed visuals for docs / export (not re-imported as source of truth). */
export function visualsAppendixForCodes(codes: string[]): string {
  const rows = codes.map(code => {
    const v = getPartnerVisual(code);
    return { code: v.partnerCode, hue: v.hue, hex: v.hex, hsl: v.hsl };
  });
  return tomlStringify({
    visuals: Object.fromEntries(rows.map(r => [r.code, r])),
  });
}
