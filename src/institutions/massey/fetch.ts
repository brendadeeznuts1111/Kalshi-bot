// @see https://bun.com/docs/runtime/webview
// @see https://bun.com/blog/bun-v1.4
// @see https://bun.com/blog/bun-v1.4.1
import { MASSEY_ORIGIN, MASSEY_HEADER_CACHE, MASSEY_WEBVIEW_PROFILE } from "./paths.ts";
import { masseyRatingsPath, type MasseySportTarget } from "./sports.ts";
import type { BunWebViewOptions } from "../event-store/visual-snapshot-meta.ts";
import { extractRatingsTableFromHtml } from "./html.ts";
import {
  MASSEY_BROWSER_UA,
  absorbDocumentCookies,
  absorbSetCookieHeaders,
  applyMasseyProxyEnv,
  isChallengeHtml,
  jarIsFresh,
  loadHeaderJar,
  masseyRequestHeaders,
  readMasseyProxyEnv,
  saveHeaderJar,
  type MasseyHeaderJar,
} from "./headers.ts";

export type MasseyFetchPath = "native-fetch" | "webview";

export type MasseyRatingsTable = {
  url: string;
  title: string;
  fetchedAtMs: number;
  headers: string[];
  rows: string[][];
  target: MasseySportTarget;
  path: MasseyFetchPath;
};

export type MasseyFetchOptions = {
  timeoutMs?: number;
  width?: number;
  height?: number;
  nativeFastPath?: boolean;
  fastPathMaxFailures?: number;
  headerCachePath?: string;
  webviewProfile?: string;
  ephemeralProfile?: boolean;
};

let nativeFastPathFailures = 0;

export function resetMasseyNativeBreaker(): void {
  nativeFastPathFailures = 0;
}

export function masseyNativeBreakerCount(): number {
  return nativeFastPathFailures;
}

export function resolveMasseyWebViewBackend(): NonNullable<BunWebViewOptions["backend"]> {
  return process.platform === "darwin" ? "webkit" : "chrome";
}

export function hasMasseyWebView(): boolean {
  return typeof Bun.WebView === "function";
}

function persistJar(path: string, jar: MasseyHeaderJar): MasseyHeaderJar {
  saveHeaderJar(path, jar);
  return jar;
}

async function tryNativeMasseyFetch(
  target: MasseySportTarget,
  url: string,
  timeoutMs: number,
  jar: MasseyHeaderJar,
  cachePath: string,
): Promise<MasseyRatingsTable | null> {
  applyMasseyProxyEnv(readMasseyProxyEnv());
  const res = await fetch(url, {
    headers: masseyRequestHeaders(jar),
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const html = await res.text();
  persistJar(cachePath, absorbSetCookieHeaders(jar, res.headers, "native-fetch"));
  if (res.status !== 200 || isChallengeHtml(html, res.status)) return null;
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

const TABLE_EXTRACT = `(() => {
  const tables = Array.from(document.querySelectorAll('table'));
  let best = null;
  for (const t of tables) {
    const rows = t.querySelectorAll('tr');
    if (rows.length > 2 && (!best || rows.length > best.rows.length)) {
      best = { rows, el: t };
    }
  }
  if (!best) return { headers: [], rows: [], cookie: document.cookie || "" };
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
  return { headers, rows, cookie: document.cookie || "" };
})()`;

async function harvestChromeCookies(
  view: { cdp?: (m: string, p?: object) => Promise<unknown> },
  jar: MasseyHeaderJar,
): Promise<MasseyHeaderJar> {
  if (typeof view.cdp !== "function") return jar;
  try {
    const result = (await view.cdp("Network.getAllCookies")) as {
      cookies?: Array<{ name: string; value: string; domain?: string; path?: string; expires?: number }>;
    };
    const incoming = (result.cookies ?? [])
      .filter((c) => c.name && typeof c.value === "string")
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || "/",
        expiresMs: c.expires && c.expires > 0 ? c.expires * 1000 : undefined,
      }));
    if (!incoming.length) return jar;
    return absorbDocumentCookies({ ...jar, cookies: incoming }, "", "masseyratings.com", "webview");
  } catch {
    return jar;
  }
}

export async function fetchMasseyRatingsTable(
  target: MasseySportTarget,
  options: MasseyFetchOptions = {},
): Promise<MasseyRatingsTable> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const url = MASSEY_ORIGIN + "/" + masseyRatingsPath(target);
  const cachePath = options.headerCachePath ?? MASSEY_HEADER_CACHE;
  let jar = loadHeaderJar(cachePath);

  const wantNative =
    options.nativeFastPath !== false &&
    nativeFastPathFailures < (options.fastPathMaxFailures ?? 2);
  if (wantNative) {
    try {
      const fast = await tryNativeMasseyFetch(target, url, Math.min(timeoutMs, 15_000), jar, cachePath);
      if (fast) {
        nativeFastPathFailures = 0;
        return fast;
      }
      nativeFastPathFailures += 1;
    } catch {
      nativeFastPathFailures += 1;
    }
    jar = loadHeaderJar(cachePath);
  }

  if (!hasMasseyWebView()) {
    const hint = jarIsFresh(jar)
      ? "header jar is present but native fetch still challenged"
      : "no cached clearance cookies";
    throw new Error("Bun.WebView unavailable in the active Bun runtime/build (" + hint + ")");
  }

  const backend = resolveMasseyWebViewBackend();
  const dataStore = options.ephemeralProfile
    ? "ephemeral"
    : { directory: options.webviewProfile ?? MASSEY_WEBVIEW_PROFILE };

  const deadline = Date.now() + timeoutMs;
  await using view = new Bun.WebView({
    backend,
    width: options.width ?? 1280,
    height: options.height ?? 900,
    dataStore,
    console: (type: string) => {
      if (type === "error") {
        // keep quiet
      }
    },
  } as ConstructorParameters<typeof Bun.WebView>[0]);

  if (backend === "chrome" && typeof view.cdp === "function") {
    try {
      await view.cdp("Network.enable");
      await view.cdp("Emulation.setUserAgentOverride", {
        userAgent: MASSEY_BROWSER_UA,
        acceptLanguage: "en-US,en;q=0.9",
        platform: "MacIntel",
      });
      await view.cdp("Network.setExtraHTTPHeaders", {
        headers: {
          "Accept-Language": "en-US,en;q=0.9",
          "Upgrade-Insecure-Requests": "1",
        },
      });
    } catch {
      // WebKit or older chrome stub
    }
  }

  await view.navigate(url);

  let title = "";
  let pollMs = 250;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error("timed out after " + timeoutMs + "ms waiting for " + url);
    }
    await Bun.sleep(pollMs);
    pollMs = 500;
    try {
      title = await view.evaluate("document.title");
      if (title && !/just a moment/i.test(title)) break;
    } catch {
      // navigation in progress
    }
  }

  const extracted = (await view.evaluate(TABLE_EXTRACT)) as {
    headers: string[];
    rows: string[][];
    cookie?: string;
  };

  jar = absorbDocumentCookies(jar, extracted.cookie ?? "", "masseyratings.com", "webview");
  jar = await harvestChromeCookies(view, jar);
  persistJar(cachePath, jar);
  nativeFastPathFailures = 0;

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
