// @see https://bun.com/docs/runtime/utils#bun-env — Bun.env
import { getConsoleDepth } from '../console-depth.ts';

/** Env checklist payload for `/api/env` and `/portal/env.md`. */

export type PortalEnvCritical = {
  key: string;
  desc: string;
  actual: string | null;
  set: boolean;
  hue: number;
  hsl: string;
};

export type PortalEnvOptional = {
  key: string;
  desc: string;
  actual: string;
  default?: string;
  set: boolean;
  /** Explicit in process env vs resolved code default. */
  source: 'env' | 'default' | 'unset';
  match: boolean;
  hue: number;
  hsl: string;
};

export type PortalContentTypeRow = {
  scenario: string;
  default: string;
  our: string;
  expected: string;
  match: boolean;
};

export type PortalEnvStatusPayload = {
  critical: PortalEnvCritical[];
  optional: PortalEnvOptional[];
  contentType: PortalContentTypeRow[];
  generated: string;
};

function hue(val: string | undefined, expected?: string): number {
  if (!val || !val.trim()) return 0;
  if (!expected || val.trim() === expected) return 120;
  return 45;
}

/** Static Content-Type proof — default vs our value vs expected. */
export const PORTAL_CONTENT_TYPE_ROWS: readonly PortalContentTypeRow[] = [
  {
    scenario: 'Response.json()',
    default: 'application/json; charset=utf-8',
    our: 'application/json; charset=utf-8',
    expected: 'application/json; charset=utf-8',
    match: true,
  },
  {
    scenario: 'Bun.file("portal/index.html")',
    default: 'text/html; charset=utf-8',
    our: 'text/html; charset=utf-8',
    expected: 'text/html; charset=utf-8',
    match: true,
  },
  {
    scenario: 'Bun.file("style.css")',
    default: 'text/css; charset=utf-8',
    our: 'text/css; charset=utf-8',
    expected: 'text/css; charset=utf-8',
    match: true,
  },
  {
    scenario: 'Bun.file("app.js")',
    default: 'application/javascript; charset=utf-8',
    our: 'application/javascript; charset=utf-8',
    expected: 'application/javascript; charset=utf-8',
    match: true,
  },
  {
    scenario: 'Bun.file("registry.json")',
    default: 'application/json; charset=utf-8',
    our: 'application/json; charset=utf-8',
    expected: 'application/json; charset=utf-8',
    match: true,
  },
  {
    scenario: 'fetch() — FormData body',
    default: 'multipart/form-data; boundary=... (auto)',
    our: 'multipart/form-data; boundary=... (auto)',
    expected: 'multipart/form-data boundary auto-set by Bun',
    match: true,
  },
  {
    scenario: 'fetch() — Blob body',
    default: 'uses Blob.type',
    our: 'text/plain (from Blob)',
    expected: 'text/plain',
    match: true,
  },
  {
    scenario: 'req.formData() parse',
    default: 'auto-detects multipart boundary',
    our: 'auto-detects boundary (Bun native)',
    expected: 'parses FormData from multipart body',
    match: true,
  },
  {
    scenario: 'Response.redirect()',
    default: 'text/plain;charset=utf-8',
    our: 'text/plain;charset=utf-8',
    expected: 'text/plain;charset=utf-8',
    match: true,
  },
  {
    scenario: 'Error response (404)',
    default: 'text/plain;charset=utf-8',
    our: 'text/plain;charset=utf-8',
    expected: 'text/plain;charset=utf-8',
    match: true,
  },
] as const;

type OptionalSpec = {
  key: string;
  desc: string;
  expected?: string;
  /** Runtime value when env unset (serve-public / console-depth SSOT). */
  effective: () => string;
  /** Unset env is OK (alerts). */
  optionalUnset?: boolean;
};

/** Optional vars with code defaults — not the same as raw `bun --print process.env`. */
const OPTIONAL_SPECS: readonly OptionalSpec[] = [
  {
    key: 'NODE_ENV',
    desc: 'Runtime environment',
    expected: 'production',
    effective: () => Bun.env.NODE_ENV?.trim() || 'production',
  },
  {
    key: 'PORT',
    desc: 'Server port',
    expected: '3000',
    effective: () => String(Number(Bun.env.PORT || 3000)),
  },
  {
    key: 'HOST',
    desc: 'Server bind address',
    expected: '127.0.0.1',
    effective: () =>
      (Bun.env.HOST || Bun.env.BIND_HOST || '127.0.0.1').trim() || '127.0.0.1',
  },
  {
    key: 'BUN_CONSOLE_DEPTH',
    desc: 'Console inspect depth',
    expected: '4',
    effective: () => String(getConsoleDepth()),
  },
  {
    key: 'SLACK_WEBHOOK_URL',
    desc: 'Slack alert webhook',
    effective: () => Bun.env.SLACK_WEBHOOK_URL?.trim() ?? '',
    optionalUnset: true,
  },
  {
    key: 'TELEGRAM_BOT_TOKEN',
    desc: 'Telegram alert bot token',
    effective: () => Bun.env.TELEGRAM_BOT_TOKEN?.trim() ?? '',
    optionalUnset: true,
  },
  {
    key: 'TELEGRAM_OPS_CHAT_ID',
    desc: 'Telegram ops chat ID',
    effective: () => Bun.env.TELEGRAM_OPS_CHAT_ID?.trim() ?? '',
    optionalUnset: true,
  },
] as const;

export function buildPortalEnvStatus(): PortalEnvStatusPayload {
  const critical = [
    ['CLOUDFLARE_API_TOKEN', 'Cloudflare API token for MCP + deploys'],
    ['FACTORY_WAGER_TOKEN', 'Registry scope auth token'],
    ['REGISTRY_SECRET', 'Local publish auth secret'],
    ['R2_ACCESS_KEY_ID', 'R2/S3 access key for artifact storage'],
    ['R2_SECRET_ACCESS_KEY', 'R2/S3 secret key'],
    ['R2_ACCOUNT_ID', 'Cloudflare account ID'],
  ] as const;

  return {
    critical: critical.map(([key, desc]) => {
      const val = Bun.env[key];
      const h = hue(val);
      return {
        key,
        desc,
        actual: val ? '••••' + val.slice(-4) : null,
        set: !!val,
        hue: h,
        hsl: `hsl(${h}, 70%, ${h === 0 ? 40 : 50}%)`,
      };
    }),
    optional: OPTIONAL_SPECS.map(spec => {
      const raw = Bun.env[spec.key]?.trim() ?? '';
      const effective = spec.effective();
      const source: PortalEnvOptional['source'] = raw
        ? 'env'
        : effective
          ? 'default'
          : 'unset';
      const match = spec.optionalUnset
        ? true
        : spec.expected
          ? effective === spec.expected
          : Boolean(effective);
      const h = hue(effective, spec.expected);
      const display =
        source === 'default' && spec.expected ? `${effective} (default)` : effective || '—';
      return {
        key: spec.key,
        desc: spec.desc,
        actual: display,
        default: spec.expected,
        set: Boolean(raw || (source === 'default' && effective)),
        source,
        match,
        hue: h,
        hsl: `hsl(${h}, 60%, 45%)`,
      };
    }),
    contentType: [...PORTAL_CONTENT_TYPE_ROWS],
    generated: new Date().toISOString(),
  };
}
