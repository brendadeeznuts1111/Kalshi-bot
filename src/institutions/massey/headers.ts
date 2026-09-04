// @see https://bun.com/blog/bun-v1.4
// @see https://bun.com/blog/bun-v1.4.1
// @see https://bun.com/docs/runtime/networking/fetch
// Header / cookie jar for Massey native-fetch. Casing is preserved on the wire
// (Bun ≥ 1.3.7). HTTPS_PROXY is re-read per fetch (Bun ≥ 1.3.12). Prefer the
// explicit `proxy: { url, headers }` fetch option for CONNECT auth. TLS is
// checked against the URL host, not Host (Bun 1.4.1) — do not spoof Host.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { MASSEY_ORIGIN } from "./paths.ts";

export const MASSEY_BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Chrome client hints that match MASSEY_BROWSER_UA. Casing matters on the wire. */
export const MASSEY_BROWSER_HINTS: Record<string, string> = {
  "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
};

export const CHALLENGE_RE =
  /just a moment|cf-chl|__cf_chl|challenge-platform|captcha|cf-mitigated/i;

export type MasseyCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expiresMs?: number;
  httpOnly?: boolean;
  secure?: boolean;
};

export type MasseyHeaderJar = {
  origin: string;
  updatedAtMs: number;
  path?: "native-fetch" | "webview";
  cookies: MasseyCookie[];
  lastStatus?: number;
  lastCfRay?: string;
};

export type MasseyProxyEnv = {
  httpProxy?: string;
  httpsProxy?: string;
  noProxy?: string;
};

/** Bun fetch `proxy` option. `headers` go on CONNECT (HTTPS) or the proxy request (HTTP). */
export type MasseyFetchProxy = {
  url: string;
  headers?: Record<string, string>;
};

export const EMPTY_JAR = (origin = MASSEY_ORIGIN): MasseyHeaderJar => ({
  origin,
  updatedAtMs: 0,
  cookies: [],
});

export function isChallengeHtml(html: string, status?: number): boolean {
  if (status === 403 || status === 503) return true;
  return CHALLENGE_RE.test(html.slice(0, 24_576));
}

export function parseSetCookie(header: string, now = Date.now()): MasseyCookie | null {
  const parts = header.split(";").map((p) => p.trim()).filter(Boolean);
  const nv = parts[0];
  if (!nv || !nv.includes("=")) return null;
  const eq = nv.indexOf("=");
  const name = nv.slice(0, eq).trim();
  const value = nv.slice(eq + 1).trim();
  if (!name) return null;
  const cookie: MasseyCookie = { name, value, path: "/" };
  for (const part of parts.slice(1)) {
    const [k, ...rest] = part.split("=");
    const key = k.trim().toLowerCase();
    const val = rest.join("=").trim();
    if (key === "domain") cookie.domain = val;
    else if (key === "path") cookie.path = val || "/";
    else if (key === "expires") {
      const t = Date.parse(val);
      if (Number.isFinite(t)) cookie.expiresMs = t;
    } else if (key === "max-age") {
      const sec = Number(val);
      if (Number.isFinite(sec)) cookie.expiresMs = now + sec * 1000;
    } else if (key === "httponly") cookie.httpOnly = true;
    else if (key === "secure") cookie.secure = true;
  }
  return cookie;
}

export function mergeCookies(into: MasseyCookie[], next: MasseyCookie[]): MasseyCookie[] {
  const map = new Map<string, MasseyCookie>();
  for (const c of into) map.set(`${c.domain ?? ""}|${c.path ?? "/"}|${c.name}`, c);
  for (const c of next) map.set(`${c.domain ?? ""}|${c.path ?? "/"}|${c.name}`, c);
  const now = Date.now();
  return [...map.values()].filter((c) => !c.expiresMs || c.expiresMs > now);
}

export function cookiesFromDocumentCookie(raw: string, domain: string): MasseyCookie[] {
  if (!raw.trim()) return [];
  return raw.split(";").flatMap((part) => {
    const eq = part.indexOf("=");
    if (eq < 1) return [];
    return [{
      name: part.slice(0, eq).trim(),
      value: part.slice(eq + 1).trim(),
      domain,
      path: "/",
    } satisfies MasseyCookie];
  });
}

export function cookieHeader(jar: MasseyHeaderJar, now = Date.now()): string {
  return jar.cookies
    .filter((c) => !c.expiresMs || c.expiresMs > now)
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

export function jarIsFresh(jar: MasseyHeaderJar, maxAgeHours = 12, now = Date.now()): boolean {
  if (!jar.cookies.length || !jar.updatedAtMs) return false;
  return now - jar.updatedAtMs < maxAgeHours * 3_600_000;
}

export function masseyRequestHeaders(jar: MasseyHeaderJar, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": MASSEY_BROWSER_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    ...MASSEY_BROWSER_HINTS,
  };
  const cookie = cookieHeader(jar);
  if (cookie) headers.Cookie = cookie;
  if (extra) Object.assign(headers, extra);
  return headers;
}

export function readMasseyProxyEnv(env: Record<string, string | undefined> = Bun.env): MasseyProxyEnv {
  const httpsProxy = (env.MASSEY_HTTPS_PROXY || env.HTTPS_PROXY || env.https_proxy || "").trim() || undefined;
  const httpProxy = (env.MASSEY_HTTP_PROXY || env.HTTP_PROXY || env.http_proxy || "").trim() || undefined;
  const noProxy = (env.MASSEY_NO_PROXY || env.NO_PROXY || env.no_proxy || "").trim() || undefined;
  return { httpProxy, httpsProxy, noProxy };
}

export function applyMasseyProxyEnv(overlay: MasseyProxyEnv): MasseyProxyEnv {
  if (overlay.httpsProxy) Bun.env.HTTPS_PROXY = overlay.httpsProxy;
  if (overlay.httpProxy) Bun.env.HTTP_PROXY = overlay.httpProxy;
  if (overlay.noProxy) Bun.env.NO_PROXY = overlay.noProxy;
  return overlay;
}

function basicProxyAuthorization(proxyUrl: string): string | undefined {
  try {
    const u = new URL(proxyUrl);
    if (!u.username && !u.password) return undefined;
    const user = decodeURIComponent(u.username);
    const pass = decodeURIComponent(u.password);
    return "Basic " + btoa(`${user}:${pass}`);
  } catch {
    return undefined;
  }
}

/**
 * Explicit Bun 1.4 `fetch` proxy option. CONNECT headers live here — not on the
 * origin request, and never as a spoofed `Host`. Env overlay remains a fallback
 * because Bun ≥ 1.3.12 re-reads HTTPS_PROXY per fetch.
 */
export function masseyFetchProxyOption(
  overlay: MasseyProxyEnv = readMasseyProxyEnv(),
  env: Record<string, string | undefined> = Bun.env,
): MasseyFetchProxy | undefined {
  const url = overlay.httpsProxy || overlay.httpProxy;
  if (!url) return undefined;
  const headers: Record<string, string> = {};
  const fromUrl = basicProxyAuthorization(url);
  if (fromUrl) headers["Proxy-Authorization"] = fromUrl;
  const extra = (env.MASSEY_PROXY_AUTHORIZATION || "").trim();
  if (extra) headers["Proxy-Authorization"] = extra;
  const extraHeader = (env.MASSEY_PROXY_HEADER || "").trim();
  if (extraHeader.includes(":")) {
    const i = extraHeader.indexOf(":");
    headers[extraHeader.slice(0, i).trim()] = extraHeader.slice(i + 1).trim();
  }
  return Object.keys(headers).length ? { url, headers } : { url };
}

export function loadHeaderJar(path: string): MasseyHeaderJar {
  if (!existsSync(path)) return EMPTY_JAR();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as MasseyHeaderJar;
    if (!parsed || !Array.isArray(parsed.cookies)) return EMPTY_JAR();
    return {
      origin: parsed.origin || MASSEY_ORIGIN,
      updatedAtMs: parsed.updatedAtMs || 0,
      path: parsed.path,
      cookies: parsed.cookies.filter((c) => c && typeof c.name === "string"),
      lastStatus: parsed.lastStatus,
      lastCfRay: parsed.lastCfRay,
    };
  } catch {
    return EMPTY_JAR();
  }
}

export function saveHeaderJar(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}
