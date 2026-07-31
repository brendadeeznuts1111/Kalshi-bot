/**
 * Live HTTP health for OFFICIAL_URLS (+ optional glossary entry urls).
 * Shared by CLI (`glossary:urls`) and HQ (`/api/health/urls`).
 *
 * @see https://bun.com/docs/runtime/networking/fetch#sending-an-http-request
 * @see official-urls.ts resolveProbeUrl
 */
import { GLOSSARY_ENTRIES } from "./glossary.ts";
import {
  OFFICIAL_URLS,
  resolveProbeUrl,
} from "./official-urls.ts";

export type UrlHealthRow = {
  label: string;
  catalogUrl: string;
  probeUrl: string;
  ok: boolean;
  status: number;
  latencyMs: number;
  skipped?: boolean;
  skipReason?: string;
  error?: string;
};

export type UrlHealthReport = {
  schemaVersion: 1;
  generatedAt: string;
  ok: boolean;
  checked: number;
  failed: number;
  skipped: number;
  rows: UrlHealthRow[];
};

function statusOk(status: number, okStatuses: readonly number[]): boolean {
  if (okStatuses.includes(status)) return true;
  return status >= 200 && status < 400;
}

export async function probeHttp(
  url: string,
  okStatuses: readonly number[],
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; latencyMs: number; error?: string }> {
  const t0 = Bun.nanoseconds();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "kalshi-bot-url-health/1" },
    });
    if (
      res.status === 404 ||
      res.status === 405 ||
      res.status === 501 ||
      !statusOk(res.status, okStatuses)
    ) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: ctrl.signal,
        headers: { "user-agent": "kalshi-bot-url-health/1" },
      });
    }
    const latencyMs = Math.round((Bun.nanoseconds() - t0) / 1e6);
    return {
      ok: statusOk(res.status, okStatuses) || res.status === 429,
      status: res.status,
      latencyMs,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      latencyMs: Math.round((Bun.nanoseconds() - t0) / 1e6),
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Kalshi exchange status for prod / demo / elections. */
export async function probeKalshiExchange(
  which: "prod" | "demo" | "elections" = "prod",
  timeoutMs = 8_000,
): Promise<UrlHealthRow> {
  const key =
    which === "demo"
      ? "tradeApiV2BaseDemo"
      : which === "elections"
        ? "tradeApiV2BaseElections"
        : "tradeApiV2Base";
  const base = OFFICIAL_URLS.kalshi[key];
  const resolved = resolveProbeUrl("kalshi", key, base)!;
  const r = await probeHttp(resolved.url, resolved.okStatuses, timeoutMs);
  return {
    label: `kalshi.${key}`,
    catalogUrl: base,
    probeUrl: resolved.url,
    ok: r.ok,
    status: r.status,
    latencyMs: r.latencyMs,
    error: r.error,
  };
}

export type ProbeCatalogOptions = {
  timeoutMs?: number;
  /** Include glossary entry `url` fields */
  includeGlossary?: boolean;
  concurrency?: number;
};

/** Full catalog probe (same targets as glossary:urls without OG). */
export async function probeOfficialCatalog(
  opts: ProbeCatalogOptions = {},
): Promise<UrlHealthReport> {
  const timeoutMs = opts.timeoutMs ?? Number(Bun.env.GLOSSARY_URL_TIMEOUT_MS ?? 8_000);
  const concurrency = opts.concurrency ?? 6;

  type Job = {
    label: string;
    catalogUrl: string;
    probeUrl: string;
    okStatuses: readonly number[];
    skipped?: boolean;
    skipReason?: string;
  };

  const jobs: Job[] = [];
  for (const [cat, urls] of Object.entries(OFFICIAL_URLS)) {
    for (const [key, url] of Object.entries(urls)) {
      if (typeof url !== "string") continue;
      if (url.startsWith("wss:") || url.startsWith("ws:")) {
        jobs.push({
          label: `official:${cat}.${key}`,
          catalogUrl: url,
          probeUrl: url,
          okStatuses: [],
          skipped: true,
          skipReason: "websocket",
        });
        continue;
      }
      if (!/^https?:\/\//i.test(url)) continue;
      const resolved = resolveProbeUrl(cat, key, url);
      if (!resolved) {
        jobs.push({
          label: `official:${cat}.${key}`,
          catalogUrl: url,
          probeUrl: url,
          okStatuses: [],
          skipped: true,
          skipReason: "probe skipped",
        });
        continue;
      }
      jobs.push({
        label: `official:${cat}.${key}`,
        catalogUrl: url,
        probeUrl: resolved.url,
        okStatuses: resolved.okStatuses,
      });
    }
  }

  if (opts.includeGlossary) {
    for (const e of GLOSSARY_ENTRIES) {
      if (typeof e.url !== "string" || !e.url || !/^https?:\/\//i.test(e.url)) continue;
      jobs.push({
        label: `glossary:${e.id}`,
        catalogUrl: e.url,
        probeUrl: e.url,
        okStatuses: [200, 204, 301, 302, 304, 429],
      });
    }
  }

  const rows: UrlHealthRow[] = new Array(jobs.length);
  let i = 0;
  async function worker() {
    while (i < jobs.length) {
      const idx = i++;
      const job = jobs[idx]!;
      if (job.skipped) {
        rows[idx] = {
          label: job.label,
          catalogUrl: job.catalogUrl,
          probeUrl: job.probeUrl,
          ok: true,
          status: 0,
          latencyMs: 0,
          skipped: true,
          skipReason: job.skipReason,
        };
        continue;
      }
      const r = await probeHttp(job.probeUrl, job.okStatuses, timeoutMs);
      rows[idx] = {
        label: job.label,
        catalogUrl: job.catalogUrl,
        probeUrl: job.probeUrl,
        ok: r.ok,
        status: r.status,
        latencyMs: r.latencyMs,
        error: r.error,
      };
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const skipped = rows.filter((r) => r.skipped).length;
  const failed = rows.filter((r) => !r.skipped && !r.ok).length;
  const checked = rows.length - skipped;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ok: failed === 0,
    checked,
    failed,
    skipped,
    rows,
  };
}
