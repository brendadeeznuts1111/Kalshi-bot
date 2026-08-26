/**
 * Read-only probe: public inventory plane vs gsid-gated priced plane.
 *
 * Never logs full gsid / JWT / passwords — fingerprints + plane classification only.
 * Operator: `bun run inventory:session-probe` · optional `PLIVE_GSID` / `--gsid=`.
 */
// @see https://bun.com/docs/api/fetch
import {
  PLIVE_STREAM_ENDPOINTS,
  type LiveStreamEndpoints,
} from '../domain/live-product-endpoints.ts';
import type { FetchFn } from '../institutions/resilient-fetch.ts';

type SessionPlaneId =
  | 'inventory_public'
  | 'shell'
  | 'session_gated'
  | 'priced_note';

type SessionPlaneCheck = {
  id: string;
  plane: SessionPlaneId;
  method: string;
  /** URL with secrets redacted. */
  url: string;
  status: number | null;
  /** Whether the check matched the expected plane behavior. */
  ok: boolean;
  expected: string;
  latencyMs: number;
  detail: Record<string, unknown>;
  error?: string | undefined;
};

type SessionPlaneProbeReport = {
  at: string;
  endpoints: {
    streamListUrl: string;
    streamOrigin: string;
    livePath: string;
    streamTokenPath: string;
    pandoraWs: string;
  };
  checks: SessionPlaneCheck[];
  summary: {
    inventoryPublicOk: boolean;
    streamTokenRequiresGsidOk: boolean;
    /**
     * Token probe with a gsid:
     * - absent: no gsid available (shell mint empty and no operator gsid)
     * - ok / fail: streamToken result for the gsid that was used
     *
     * Note: shell-minted gsid often fails closed (403) — that is expected and
     * does **not** fail `allRequiredOk` unless source is `operator`.
     */
    boundGsid: 'absent' | 'ok' | 'fail';
    /** Where the gsid for stream-token-with-gsid came from. */
    gsidSource: 'absent' | 'operator' | 'shell_mint';
    allRequiredOk: boolean;
  };
};

type SessionPlaneProbeOptions = {
  /**
   * Operator seat-bound SportsWidgets session (from getUltraLiveURL handoff).
   * When omitted, probe reuses the anonymous shell `x-gsid` / GSID cookie mint.
   * Never written to disk by this probe.
   */
  gsid?: string;
  /**
   * When true (default), use shell-minted x-gsid for streamToken if no operator gsid.
   * Set false to only test explicit PLIVE_GSID/--gsid.
   */
  useShellGsid?: boolean;
  fetchImpl?: FetchFn;
  endpoints?: LiveStreamEndpoints;
  streamTokenPath?: string;
  pandoraWsUrl?: string;
  timeoutMs?: number;
};

const DEFAULT_STREAM_TOKEN_PATH = '/betFactoryV2/api/streamToken.php';
const DEFAULT_PANDORA_WS = 'wss://pandora.ganchrow.com/socket.io/?EIO=4&transport=websocket';

/** Fingerprint a secret: never full value. */
export function fingerprintSecret(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const v = value.trim();
  if (v.length <= 6) return `len=${v.length}`;
  return `${v.slice(0, 4)}…${v.slice(-2)} (len=${v.length})`;
}

/** Strip gsid / hash query params and rewrite long tokens in paths. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (/gsid|hash|token|password|pass|auth/i.test(key)) {
        u.searchParams.set(key, '<redacted>');
      }
    }
    return u.toString();
  } catch {
    return url
      .replace(/([?&](?:gsid|hash|token|password|pass)=)[^&]*/gi, '$1<redacted>')
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<jwt>');
  }
}

/** Decode JWT payload claims without verification — non-secret fields only. */
export function jwtSafeClaims(token: string): Record<string, unknown> | null {
  const parts = token.trim().split('.');
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const json = JSON.parse(atob(b64 + pad)) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    if (typeof json.domain === 'string') out.domain = json.domain;
    if (typeof json.cid === 'string') out.cid = json.cid;
    if (typeof json.exp === 'number') {
      out.exp = json.exp;
      out.expiresInSec = Math.max(0, json.exp - Math.floor(Date.now() / 1000));
    }
    if (typeof json.iat === 'number') out.iat = json.iat;
    // never include ipAddress, userId, sub, etc.
    return out;
  } catch {
    return null;
  }
}

function streamTokenUrl(origin: string, path: string): string {
  return new URL(path, origin.endsWith('/') ? origin : `${origin}/`).toString();
}

/** Extract GSID value from Set-Cookie lines (never log raw). */
export function gsidFromSetCookie(setCookie: readonly string[]): string | null {
  for (const line of setCookie) {
    const m = line.match(/^GSID=([^;]+)/i);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

async function timedFetch(
  fetchImpl: FetchFn,
  input: string,
  init: RequestInit | undefined,
  timeoutMs: number
): Promise<{ res: Response | null; latencyMs: number; error?: string }> {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(input, { ...init, signal: ac.signal });
    return { res, latencyMs: Date.now() - started };
  } catch (e) {
    return {
      res: null,
      latencyMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

function headerGet(res: Response, name: string): string | null {
  return res.headers.get(name) ?? res.headers.get(name.toLowerCase());
}

/**
 * Probe public stream-list, anonymous shell mint, streamToken gate, optional bound gsid.
 * Does not open Pandora WebSocket (see `partner:pandora-probe`).
 */
export async function probeSessionPlanes(
  options: SessionPlaneProbeOptions = {}
): Promise<SessionPlaneProbeReport> {
  const ep = options.endpoints ?? PLIVE_STREAM_ENDPOINTS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const tokenPath = options.streamTokenPath ?? DEFAULT_STREAM_TOKEN_PATH;
  const pandoraWs = options.pandoraWsUrl ?? DEFAULT_PANDORA_WS;
  const operatorGsid = options.gsid?.trim() || undefined;
  const useShellGsid = options.useShellGsid !== false;
  const tokenUrl = streamTokenUrl(ep.streamOrigin, tokenPath);
  const liveUrl = `${ep.streamOrigin}${ep.livePathPrefix}${ep.livePathPrefix.includes('?') ? '&' : '?'}lang=en`;

  const checks: SessionPlaneCheck[] = [];
  let shellMintedGsid: string | null = null;

  // 1) Public inventory catalog
  {
    const url = ep.streamListUrl;
    const { res, latencyMs, error } = await timedFetch(
      fetchImpl,
      url,
      {
        method: 'GET',
        headers: {
          accept: 'application/json, text/plain, */*',
          origin: ep.streamOrigin,
          referer: ep.streamReferer,
        },
      },
      timeoutMs
    );
    let sportBuckets = 0;
    let eventApprox = 0;
    let topKeys: string[] = [];
    if (res && res.ok) {
      try {
        const body = (await res.json()) as {
          sports?: Record<string, { count?: number; events?: Record<string, unknown> }>;
        };
        topKeys = body && typeof body === 'object' ? Object.keys(body).slice(0, 8) : [];
        const sports = body?.sports;
        if (sports && typeof sports === 'object') {
          sportBuckets = Object.keys(sports).length;
          for (const b of Object.values(sports)) {
            if (typeof b?.count === 'number') eventApprox += b.count;
            else if (b?.events && typeof b.events === 'object') {
              eventApprox += Object.keys(b.events).length;
            }
          }
        }
      } catch {
        /* ignore parse */
      }
    }
    const status = res?.status ?? null;
    const ok = status === 200 && sportBuckets > 0;
    checks.push({
      id: 'stream-list-v2',
      plane: 'inventory_public',
      method: 'GET',
      url: redactUrl(url),
      status,
      ok,
      expected: '200 JSON sports.* without gsid',
      latencyMs,
      detail: {
        sportBuckets,
        eventApprox,
        topKeys,
        requiresGsid: false,
      },
      error,
    });
  }

  // 2) Anonymous live shell (mints x-gsid / GSID — fingerprint only)
  {
    const { res, latencyMs, error } = await timedFetch(
      fetchImpl,
      liveUrl,
      {
        method: 'GET',
        headers: {
          accept: 'text/html,application/xhtml+xml',
          referer: ep.streamReferer,
        },
        redirect: 'follow',
      },
      timeoutMs
    );
    const status = res?.status ?? null;
    const xGsid = res ? headerGet(res, 'x-gsid') : null;
    const setCookie = res?.headers.getSetCookie?.() ?? [];
    const cookieGsid = gsidFromSetCookie(setCookie);
    const hasGsidCookie = !!cookieGsid || setCookie.some((c) => /^GSID=/i.test(c));
    shellMintedGsid = (xGsid?.trim() || cookieGsid || null) as string | null;
    // Consume body without retaining
    if (res) await res.arrayBuffer().catch(() => null);
    const ok = status === 200 && (!!xGsid || hasGsidCookie);
    checks.push({
      id: 'live-shell-anonymous',
      plane: 'shell',
      method: 'GET',
      url: redactUrl(liveUrl),
      status,
      ok,
      expected: '200 HTML + minted x-gsid/GSID (anonymous session)',
      latencyMs,
      detail: {
        xGsidFingerprint: fingerprintSecret(xGsid),
        gsidCookiePresent: hasGsidCookie,
        note:
          'Shell mint proves anonymous session mint; seat-bound gsid still preferred via PLIVE_GSID/--gsid after getUltraLiveURL',
      },
      error,
    });
  }

  // 3) streamToken without bound gsid → must fail closed
  {
    const { res, latencyMs, error } = await timedFetch(
      fetchImpl,
      tokenUrl,
      {
        method: 'GET',
        headers: {
          accept: '*/*',
          referer: ep.streamReferer,
        },
      },
      timeoutMs
    );
    const status = res?.status ?? null;
    let bodyKind: string | null = null;
    if (res) {
      const text = await res.text().catch(() => '');
      if (/eyJ[A-Za-z0-9_-]+\./.test(text)) bodyKind = 'jwt';
      else if (text.trim().startsWith('{')) bodyKind = 'json';
      else bodyKind = text ? 'text' : 'empty';
    }
    // Expect gated: 403/401/ non-JWT success
    const ok = status !== null && status !== 200;
    checks.push({
      id: 'stream-token-no-gsid',
      plane: 'session_gated',
      method: 'GET',
      url: redactUrl(tokenUrl),
      status,
      ok,
      expected: 'non-200 without x-gsid (typically 403)',
      latencyMs,
      detail: { bodyKind, requiresGsid: true },
      error,
    });
  }

  // 4) streamToken with gsid (operator seat-bound preferred; else shell mint)
  const gsidSource: SessionPlaneProbeReport['summary']['gsidSource'] = operatorGsid
    ? 'operator'
    : useShellGsid && shellMintedGsid
      ? 'shell_mint'
      : 'absent';
  const gsidForToken =
    operatorGsid || (useShellGsid ? shellMintedGsid || undefined : undefined);

  if (gsidForToken) {
    const { res, latencyMs, error } = await timedFetch(
      fetchImpl,
      tokenUrl,
      {
        method: 'GET',
        headers: {
          accept: '*/*',
          referer: `${ep.streamOrigin}${ep.livePathPrefix}`,
          'x-gsid': gsidForToken,
        },
      },
      timeoutMs
    );
    const status = res?.status ?? null;
    let jwtClaims: Record<string, unknown> | null = null;
    let bodyKind = 'empty';
    if (res) {
      const text = (await res.text().catch(() => '')).trim();
      if (/^eyJ[A-Za-z0-9_-]+\./.test(text)) {
        bodyKind = 'jwt';
        jwtClaims = jwtSafeClaims(text);
      } else if (text.startsWith('{')) bodyKind = 'json';
      else if (text) bodyKind = 'text';
    }
    const ok = status === 200 && bodyKind === 'jwt';
    checks.push({
      id: 'stream-token-with-gsid',
      plane: 'session_gated',
      method: 'GET',
      url: redactUrl(tokenUrl),
      status,
      ok,
      expected:
        gsidSource === 'operator'
          ? '200 JWT when x-gsid is seat-bound (operator)'
          : '200 JWT if shell mint is accepted (often 403 — diagnostic only)',
      latencyMs,
      detail: {
        gsidSource,
        gsidFingerprint: fingerprintSecret(gsidForToken),
        bodyKind,
        jwtClaims,
        tokenFingerprint: bodyKind === 'jwt' ? 'jwt-present' : null,
        diagnosticOnly: gsidSource === 'shell_mint',
        note:
          gsidSource === 'shell_mint' && !ok
            ? 'Shell mint rejected by streamToken — use seat-bound PLIVE_GSID/--gsid after getUltraLiveURL'
            : undefined,
        next: 'Pandora WS uses token — partner:pandora-probe (do not log JWT)',
      },
      error,
    });
  } else {
    checks.push({
      id: 'stream-token-with-gsid',
      plane: 'session_gated',
      method: 'GET',
      url: redactUrl(tokenUrl),
      status: null,
      ok: true,
      expected:
        'skipped — shell did not mint gsid; pass --gsid= or PLIVE_GSID for seat-bound check',
      latencyMs: 0,
      detail: {
        skipped: true,
        gsidSource: 'absent',
        hint: 'gsid from shell mint (auto) or plive /live/?gsid=… after getUltraLiveURL (never commit)',
      },
    });
  }

  // 5) Priced plane note (no network)
  checks.push({
    id: 'pandora-ws',
    plane: 'priced_note',
    method: 'NOTE',
    url: redactUrl(pandoraWs),
    status: null,
    ok: true,
    expected: 'not probed here — use partner:pandora-probe',
    latencyMs: 0,
    detail: {
      requires: 'streamToken JWT from gsid (shell mint or seat-bound)',
      inventoryUsesPandora: false,
    },
  });

  const inv = checks.find((c) => c.id === 'stream-list-v2');
  const noGsid = checks.find((c) => c.id === 'stream-token-no-gsid');
  const withGsid = checks.find((c) => c.id === 'stream-token-with-gsid');
  const boundGsid: SessionPlaneProbeReport['summary']['boundGsid'] =
    gsidSource === 'absent'
      ? 'absent'
      : withGsid?.ok
        ? 'ok'
        : 'fail';

  const inventoryPublicOk = !!inv?.ok;
  const streamTokenRequiresGsidOk = !!noGsid?.ok;
  // Required path: public inventory + fail-closed without gsid.
  // Operator seat-bound gsid must mint JWT when provided.
  // Shell-mint token probe is diagnostic only (often 403 — anonymous ≠ seat).
  const allRequiredOk =
    inventoryPublicOk &&
    streamTokenRequiresGsidOk &&
    (gsidSource !== 'operator' || boundGsid === 'ok');

  return {
    at: new Date().toISOString(),
    endpoints: {
      streamListUrl: ep.streamListUrl,
      streamOrigin: ep.streamOrigin,
      livePath: ep.livePathPrefix,
      streamTokenPath: tokenPath,
      pandoraWs,
    },
    checks,
    summary: {
      inventoryPublicOk,
      streamTokenRequiresGsidOk,
      boundGsid,
      gsidSource,
      allRequiredOk,
    },
  };
}

/** Human TTY lines (no secrets). */
export function formatSessionPlaneProbeReport(report: SessionPlaneProbeReport): string {
  const lines: string[] = [];
  lines.push(`session-plane-probe @ ${report.at}`);
  const gsidLabel =
    report.summary.gsidSource === 'absent'
      ? 'absent'
      : `${report.summary.boundGsid}(${report.summary.gsidSource})`;
  lines.push(
    `summary: inventory_public=${report.summary.inventoryPublicOk ? 'PASS' : 'FAIL'} ` +
      `token_requires_gsid=${report.summary.streamTokenRequiresGsidOk ? 'PASS' : 'FAIL'} ` +
      `gsid_token=${gsidLabel} ` +
      `required=${report.summary.allRequiredOk ? 'OK' : 'FAIL'}`,
  );
  lines.push('');
  for (const c of report.checks) {
    const mark = c.ok ? '✓' : '✗';
    const st = c.status == null ? '—' : String(c.status);
    lines.push(`${mark} [${c.plane}] ${c.id}  ${c.method} ${st}  ${c.latencyMs}ms`);
    lines.push(`    ${c.url}`);
    lines.push(`    expected: ${c.expected}`);
    if (c.error) lines.push(`    error: ${c.error}`);
    const d = c.detail;
    if (c.id === 'stream-list-v2') {
      lines.push(
        `    sports=${d.sportBuckets ?? '?'} events≈${d.eventApprox ?? '?'} keys=${JSON.stringify(d.topKeys ?? [])}`
      );
    } else if (c.id === 'live-shell-anonymous') {
      lines.push(
        `    x-gsid=${d.xGsidFingerprint ?? 'none'} cookie=${d.gsidCookiePresent ? 'yes' : 'no'}`
      );
    } else if (c.id === 'stream-token-with-gsid' && !d.skipped) {
      lines.push(
        `    source=${d.gsidSource ?? '?'} gsid=${d.gsidFingerprint ?? '?'} body=${d.bodyKind} jwt=${JSON.stringify(d.jwtClaims ?? null)}`,
      );
    } else if (c.id === 'stream-token-no-gsid') {
      lines.push(`    bodyKind=${d.bodyKind ?? '?'}`);
    } else if (c.id === 'pandora-ws') {
      lines.push(`    ${String(d.next ?? d.requires ?? '')}`);
    }
  }
  lines.push('');
  lines.push(
    'planes: inventory = stream-list-v2 (public); prices = gsid → streamToken → Pandora'
  );
  return lines.join('\n');
}
