// @see https://bun.com/docs/runtime/webview#new-bun-webview-options
// @see https://bun.com/blog/bun-v1.3.12#bun-webview-headless-browser-automation
import { MS_PER_DAY } from "../research/constants.ts";
import {
  dashboardBaseUrl,
  fetchDashboardJson,
  type AgentStatusPayload,
} from "./dashboard-client.ts";
import { DASHBOARD_ROUTES } from "./dashboard-views.ts";

export type DashboardPageProbe = {
  title: string;
  h1: string;
  meta: {
    runId: string;
    generatedAt: string;
    shortlist: number;
    stats: { shortlist: number };
  } | null;
  hasRunButton: boolean;
  bannerClass: string;
  bannerText: string;
};

export type VerifyCheck = {
  id: string;
  ok: boolean;
  detail: string;
};

export type VerifyDashboardResult = {
  ok: boolean;
  dashboardUrl: string;
  checks: VerifyCheck[];
  api: AgentStatusPayload | null;
  page: DashboardPageProbe | null;
};

export type VerifyDashboardOptions = {
  maxAgeDays?: number;
  requirePulse?: boolean;
  requireShortlist?: boolean;
};

export type VerifyDashboardDeps = {
  fetchStatus?: () => Promise<AgentStatusPayload | null>;
  probePage?: (url: string) => Promise<DashboardPageProbe>;
};

/** Evaluated in the dashboard page — keep in sync with {@link renderAgentDashboardMeta}. */
export const DASHBOARD_PROBE_EVAL = `(() => {
  const title = document.title || "";
  const h1 = document.querySelector("h1")?.textContent || "";
  const el = document.getElementById("agent-dashboard-meta");
  let meta = null;
  if (el && el.textContent) {
    try { meta = JSON.parse(el.textContent); } catch (_) {}
  }
  const banner = document.getElementById("status-banner");
  return {
    title,
    h1,
    meta,
    hasRunButton: !!document.getElementById("run-research"),
    bannerClass: banner ? banner.className : "",
    bannerText: banner ? (banner.textContent || "").trim() : "",
  };
})()`;

function resolveMaxAgeDays(override?: number): number {
  if (override !== undefined) return override;
  const raw = Bun.env.DASHBOARD_VERIFY_MAX_AGE_DAYS?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 21;
}

function resolveRequirePulse(override?: boolean): boolean {
  if (override !== undefined) return override;
  return Bun.env.DASHBOARD_VERIFY_REQUIRE_PULSE === "1";
}

async function defaultFetchStatus(): Promise<AgentStatusPayload | null> {
  type RemoteStatus = {
    state: AgentStatusPayload["state"];
    busy: boolean;
    latestRun: AgentStatusPayload["latestRun"];
    pulse: AgentStatusPayload["pulse"];
    pulseLog: string;
    verification?: AgentStatusPayload["verification"];
  };
  const remote = await fetchDashboardJson<RemoteStatus>(DASHBOARD_ROUTES.status);
  if (!remote) return null;
  return {
    source: "dashboard-api",
    dashboardUrl: dashboardBaseUrl(),
    ...remote,
    verification: remote.verification ?? null,
  };
}

async function defaultProbePage(url: string): Promise<DashboardPageProbe> {
  const backend = process.platform === "darwin" ? "webkit" : "chrome";
  await using view = new Bun.WebView({
    width: 1280,
    height: 900,
    backend,
  });
  await view.navigate(url);
  const probe = await view.evaluate<DashboardPageProbe>(DASHBOARD_PROBE_EVAL);
  return probe;
}

function check(id: string, ok: boolean, detail: string): VerifyCheck {
  return { id, ok, detail };
}

export function evaluateVerifyChecks(
  api: AgentStatusPayload | null,
  page: DashboardPageProbe | null,
  opts: VerifyDashboardOptions = {},
): VerifyCheck[] {
  const checks: VerifyCheck[] = [];
  const maxAgeMs = resolveMaxAgeDays(opts.maxAgeDays) * MS_PER_DAY;
  const requirePulse = resolveRequirePulse(opts.requirePulse);
  const requireShortlist = opts.requireShortlist !== false;

  checks.push(
    check(
      "api_reachable",
      api?.source === "dashboard-api",
      api ? "GET /api/status ok" : "Dashboard API unreachable",
    ),
  );

  if (!api) {
    checks.push(check("page_probe", false, "skipped — API down"));
    return checks;
  }

  checks.push(
    check(
      "not_busy",
      !api.busy && api.state.phase !== "running-research",
      api.busy ? "Research in progress" : `phase=${api.state.phase}`,
    ),
  );

  checks.push(
    check(
      "not_error",
      api.state.phase !== "error",
      api.state.message ?? "no error",
    ),
  );

  checks.push(
    check(
      "latest_run",
      api.latestRun !== null,
      api.latestRun ? api.latestRun.runId : "no production run in cache",
    ),
  );

  if (api.latestRun) {
    const ageMs = Date.now() - Date.parse(api.latestRun.generatedAt);
    const fresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= maxAgeMs;
    checks.push(
      check(
        "freshness",
        fresh,
        fresh
          ? `${Math.round(ageMs / MS_PER_DAY)}d old (max ${resolveMaxAgeDays(opts.maxAgeDays)}d)`
          : `stale or invalid generatedAt=${api.latestRun.generatedAt}`,
      ),
    );
  }

  if (requirePulse) {
    checks.push(
      check(
        "pulse_ok",
        api.pulse?.ok === true,
        api.pulse ? `pulse ${api.pulse.ok ? "ok" : "FAIL"} @ ${api.pulse.ts}` : "no pulse ticks",
      ),
    );
  }

  checks.push(
    check(
      "page_renders",
      page !== null && page.h1.includes("Kalshi Agent Dashboard"),
      page ? `title=${page.title}` : "WebView probe failed",
    ),
  );

  checks.push(
    check(
      "page_meta",
      page?.meta !== null && page?.meta !== undefined,
      page?.meta ? `runId=${page.meta.runId}` : "missing #agent-dashboard-meta",
    ),
  );

  if (page?.meta && api.latestRun) {
    checks.push(
      check(
        "run_id_parity",
        page.meta.runId === api.latestRun.runId,
        `api=${api.latestRun.runId} page=${page.meta.runId}`,
      ),
    );
    checks.push(
      check(
        "timestamp_parity",
        page.meta.generatedAt === api.latestRun.generatedAt,
        `api=${api.latestRun.generatedAt} page=${page.meta.generatedAt}`,
      ),
    );
  }

  if (requireShortlist && api.latestRun) {
    checks.push(
      check(
        "shortlist_nonempty",
        api.latestRun.shortlist > 0,
        `shortlist=${api.latestRun.shortlist}`,
      ),
    );
  }

  checks.push(
    check(
      "run_button",
      page?.hasRunButton === true,
      page?.hasRunButton ? "Run research control present" : "missing #run-research",
    ),
  );

  return checks;
}

export async function verifyDashboard(
  opts: VerifyDashboardOptions = {},
  deps: VerifyDashboardDeps = {},
): Promise<VerifyDashboardResult> {
  const dashboardUrl = dashboardBaseUrl();
  const fetchStatus = deps.fetchStatus ?? defaultFetchStatus;
  const probePage = deps.probePage ?? defaultProbePage;

  const api = await fetchStatus();
  let page: DashboardPageProbe | null = null;

  if (api?.source === "dashboard-api") {
    try {
      page = await probePage(`${dashboardUrl}${DASHBOARD_ROUTES.home}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      page = null;
      console.error("[verify-dashboard] WebView probe failed:", message);
    }
  }

  const checks = evaluateVerifyChecks(api, page, opts);
  const ok = checks.every((c) => c.ok);

  return { ok, dashboardUrl, checks, api, page };
}

export function formatVerifyDashboard(result: VerifyDashboardResult): string {
  const lines = [
    `Dashboard verify: ${result.ok ? "PASS" : "FAIL"} (${result.dashboardUrl})`,
    "",
  ];
  for (const c of result.checks) {
    lines.push(`  ${c.ok ? "✓" : "✗"} ${c.id}: ${c.detail}`);
  }
  return lines.join("\n");
}
