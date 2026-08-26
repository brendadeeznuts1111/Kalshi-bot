// @see https://bun.com/docs/runtime/webview
// @see https://bun.com/docs/runtime/fetch
import { MASSEY_ORIGIN } from "./paths.ts";
import { masseyRatingsPath, type MasseySportTarget } from "./sports.ts";
import type { BunWebViewOptions } from "../event-store/visual-snapshot-meta.ts";
import { extractRatingsTableFromHtml } from "./html.ts";

/** How a table was fetched: native fetch (fast) or headless WebView (fallback). */
export type MasseyFetchPath = "native-fetch" | "webview";

/** Raw ratings table extracted from the rendered Massey page. */
export type MasseyRatingsTable = {
  url: string;
  title: string;
  fetchedAtMs: number;
  /** Column headers (e.g. Team, Rec, Δ, Rat, Pwr, HFA, SoS, SSF, EW, EL). */
  headers: string[];
  /** Data rows, one array per <tr> (first child cell trimmed). */
  rows: string[][];
  /** Source target that produced the table. */
  target: MasseySportTarget;
  path: MasseyFetchPath;
};

export type MasseyFetchOptions = {
  /** Max wall time waiting for the Cloudflare challenge + table render. */
  timeoutMs?: number;
  width?: number;
  height?: number;
  /** Try Bun native fetch first; fall back to WebView on challenge. Default true. */
  nativeFastPath?: boolean;
  /** Stop attempting the native fast path after N consecutive failures. Default 2. */
  fastPathMaxFailures?: number;
};

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const CHALLENGE_RE = /just a moment|cf-chl|__cf_chl|challenge-platform|captcha/i;

/** Consecutive native-fetch challenge failures (circuit breaker). */
let nativeFastPathFailures = 0;

export function resetMasseyNativeBreaker(): void {
  nativeFastPathFailures = 0;
}

export function masseyNativeBreakerCount(): number {
  return nativeFastPathFailures;
}

/** webkit on macOS (zero deps), chrome elsewhere (matches tennis/liquidity ground). */
export function resolveMasseyWebViewBackend(): NonNullable<BunWebViewOptions["backend"]> {
  return process.platform === "darwin" ? "webkit" : "chrome";
}

export function hasMasseyWebView(): boolean {
  return typeof Bun.WebView === "function";
}

async function tryNativeMasseyFetch(
  target: MasseySportTarget,
  url: string,
  timeoutMs: number,
): Promise<MasseyRatingsTable | null> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status !== 200) return null;
  const html = await res.text();
  if (CHALLENGE_RE.test(html.slice(0, 16_384))) return null;
  const extracted = await extractRatingsTableFromHtml(html);
  if (!extracted) return null;
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return {
    url,
    title: titleMatch ? titleMatch[1]!.trim() : "",
    fetchedAtMs: Date.now(),
    headers: extracted.headers,
    rows: extracted.rows,
    target,
    path: "native-fetch",
  };
}

/**
 * Fetch a Massey ratings table.
 *
 * Fast path: Bun native fetch + HTMLRewriter (milliseconds when Cloudflare does
 * not challenge). Fallback: headless Bun.WebView renders the page through the
 * challenge and we extract the table from the DOM (Massey "Export CSV" is
 * client-side, so DOM extraction is the canonical source). A circuit breaker
 * stops retrying the native path after repeated 403s so it never adds latency.
 */
export async function fetchMasseyRatingsTable(
  target: MasseySportTarget,
  options: MasseyFetchOptions = {},
): Promise<MasseyRatingsTable> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const url = MASSEY_ORIGIN + "/" + masseyRatingsPath(target);

  const wantNative =
    options.nativeFastPath !== false &&
    nativeFastPathFailures < (options.fastPathMaxFailures ?? 2);
  if (wantNative) {
    try {
      const fast = await tryNativeMasseyFetch(target, url, Math.min(timeoutMs, 15_000));
      if (fast) return fast;
      nativeFastPathFailures += 1;
    } catch {
      nativeFastPathFailures += 1;
    }
  }

  if (!hasMasseyWebView()) {
    throw new Error("Bun.WebView unavailable in the active Bun runtime/build");
  }

  const deadline = Date.now() + timeoutMs;
  await using view = new Bun.WebView({
    backend: resolveMasseyWebViewBackend(),
    width: options.width ?? 1280,
    height: options.height ?? 900,
    console: (type: string, ...args: unknown[]) => {
      if (type === "error") {
        // Massey pages may log benign errors; keep the console quiet by default.
      }
    },
  });

  await view.navigate(url);

  // Wait for the Cloudflare interstitial ("Just a moment…") to clear and the
  // ratings table to render. Poll fast early, back off to 500ms.
  let title = "";
  let pollMs = 250;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error("timed out after " + timeoutMs + "ms waiting for " + url);
    }
    await Bun.sleep(pollMs);
    pollMs = pollMs >= 500 ? 500 : 500;
    try {
      title = await view.evaluate("document.title");
      if (title && !/just a moment/i.test(title)) break;
    } catch {
      // navigation in progress
    }
  }

  const EXTRACT = `(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    let best = null;
    for (const t of tables) {
      const rows = t.querySelectorAll('tr');
      if (rows.length > 2 && (!best || rows.length > best.rows.length)) {
        best = { rows, el: t };
      }
    }
    if (!best) return { headers: [], rows: [] };
    const headerRow = best.el.querySelector('tr');
    let headers = [];
    const th = best.el.querySelectorAll('thead th, thead td, tr:first-child th');
    if (th.length > 0) {
      headers = Array.from(th).map(c => (c.textContent || '').trim());
    } else if (headerRow) {
      headers = Array.from(headerRow.children).map(c => (c.textContent || '').trim());
    }
    const rows = Array.from(best.el.querySelectorAll('tr'))
      .filter(tr => tr !== headerRow && tr.querySelectorAll('th').length === 0)
      .map(tr => Array.from(tr.children).map(td => (td.textContent || '').trim()));
    return { headers, rows };
  })()`;

  const extracted = (await view.evaluate(EXTRACT)) as {
    headers: string[];
    rows: string[][];
  };

  return {
    url,
    title,
    fetchedAtMs: Date.now(),
    headers: extracted.headers,
    rows: extracted.rows,
    target,
    path: "webview",
  };
}
