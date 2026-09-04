// @see https://bun.com/docs/runtime/webview
// @see https://bun.com/docs/runtime/networking/fetch
// @see https://bun.com/blog/bun-v1.4
// @see https://bun.com/blog/bun-v1.4.1
import { MASSEY_ORIGIN, MASSEY_HEADER_CACHE, MASSEY_WEBVIEW_PROFILE } from "./paths.ts";
import { masseyRatingsPath, type MasseySportTarget } from "./sports.ts";
import type { BunWebViewOptions } from "../event-store/visual-snapshot-meta.ts";
import { extractRatingsTableFromHtml } from "./html.ts";
import {
  MASSEY_BROWSER_UA,
  absorbCdpCookies,
  absorbDocumentCookies,
  absorbSetCookieHeaders,
  applyMasseyProxyEnv,
  cookiesToCdpSet,
  isChallengeHtml,
  jarIsFresh,
  loadHeaderJar,
  masseyFetchProxyOption,
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

type MasseyView = {
  navigate: (url: string) => Promise<unknown>;
  evaluate: (script: string) => Promise<unknown>;
  close?: () => void | Promise<void>;
  cdp?: (method: string, params?: object) => Promise<unknown>;
};

let nativeFastPathFailures = 0;
let sharedView: MasseyView | null = null;
let sharedViewKey = "";

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
  const overlay = readMasseyProxyEnv();
  applyMasseyProxyEnv(overlay);
  const proxy = masseyFetchProxyOption(overlay);
  const res = await fetch(url, {
    headers: masseyRequestHeaders(jar),
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    ...(proxy ? { proxy } : {}),
  });
  const html = await res.text();
  persistJar(cachePath, absorbSetCookieHeaders(jar, res.headers, "native-fetch", res.status));
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

async function harvestChromeCookies(view: MasseyView, jar: MasseyHeaderJar): Promise<MasseyHeaderJar> {
  if (typeof view.cdp !== "function") return jar;
  try {
    const result = (await view.cdp("Network.getCookies", { urls: [MASSEY_ORIGIN + "/"] })) as {
      cookies?: Array<{ name: string; value: string; domain?: string; path?: string; expires?: number; httpOnly?: boolean; secure?: boolean }>;
    };
    return absorbCdpCookies(jar, result.cookies ?? [], "webview");
  } catch {
    try {
      const result = (await view.cdp("Network.getAllCookies")) as {
        cookies?: Array<{ name: string; value: string; domain?: string; path?: string; expires?: number }>;
      };
      return absorbCdpCookies(jar, result.cookies ?? [], "webview");
    } catch {
      return jar;
    }
  }
}

async function primeChromeSession(view: MasseyView, jar: MasseyHeaderJar): Promise<void> {
  if (typeof view.cdp !== "function") return;
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
    for (const cookie of cookiesToCdpSet(jar)) {
      try {
        await view.cdp("Network.setCookie", cookie);
      } catch {
        // individual cookie rejected
      }
    }
  } catch {
    // WebKit or older chrome stub
  }
}

function viewKey(options: MasseyFetchOptions): string {
  return [
    options.ephemeralProfile ? "eph" : "persist",
    options.webviewProfile ?? MASSEY_WEBVIEW_PROFILE,
    String(options.width ?? 1280),
    String(options.height ?? 900),
  ].join("|");
}

function openMasseyView(options: MasseyFetchOptions): { view: MasseyView; owned: boolean } {
  const backend = resolveMasseyWebViewBackend();
  const dataStore = options.ephemeralProfile
    ? "ephemeral"
    : { directory: options.webviewProfile ?? MASSEY_WEBVIEW_PROFILE };
  const key = viewKey(options);

  if (!options.ephemeralProfile && sharedView && sharedViewKey === key) {
    return { view: sharedView, owned: false };
  }

  const view = new Bun.WebView({
    backend,
    width: options.width ?? 1280,
    height: options.height ?? 900,
    dataStore,
    console: (type: string) => {
      if (type === "error") {
        // keep quiet
      }
    },
  } as ConstructorParameters<typeof Bun.WebView>[0]) as unknown as MasseyView;

  if (!options.ephemeralProfile) {
    sharedView = view;
    sharedViewKey = key;
    return { view, owned: false };
  }
  return { view, owned: true };
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

  const { view, owned } = openMasseyView(options);
  const deadline = Date.now() + timeoutMs;

  try {
    await view.navigate("about:blank");
    await primeChromeSession(view, jar);
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
        title = String(await view.evaluate("document.title") ?? "");
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
  } finally {
    if (owned && typeof view.close === "function") {
      await view.close();
    }
  }
}
