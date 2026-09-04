// @see https://bun.com/blog/bun-v1.4
// @see https://bun.com/blog/bun-v1.4.1
// Header / cookie jar for Massey native-fetch. Casing is preserved on the wire
// (Bun ≥ 1.3.7). HTTPS_PROXY is re-read per fetch (Bun ≥ 1.3.12). TLS is
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
};

export type MasseyHeaderJar = {
  origin: string;
  updatedAtMs: number;
  path?: "native-fetch" | "webview";
  cookies: MasseyCookie[];
  lastStatus?: number;
  lastCfRay?: string;
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
    }
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
    "Accept-Encoding": "gzip, deflate, br",
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

export type MasseyProxyEnv = {
  httpProxy?: string;
  httpsProxy?: string;
  noProxy?: string;
};

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

export function saveHeaderJar(path: string, jar: MasseyHeaderJar): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(jar, null, 2) + "\n");
}

export function absorbSetCookieHeaders(
  jar: MasseyHeaderJar,
  headers: Headers,
  path: MasseyHeaderJar["path"],
): MasseyHeaderJar {
  const incoming: MasseyCookie[] = [];
  const setCookies =
    typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  if (setCookies.length) {
    for (const line of setCookies) {
      const c = parseSetCookie(line);
      if (c) incoming.push(c);
    }
  } else {
    const single = headers.get("set-cookie");
    if (single) {
      const c = parseSetCookie(single);
      if (c) incoming.push(c);
    }
  }
  return {
    ...jar,
    updatedAtMs: incoming.length ? Date.now() : jar.updatedAtMs,
    path,
    cookies: incoming.length ? mergeCookies(jar.cookies, incoming) : jar.cookies,
    lastStatus: Number(headers.get("status")) || jar.lastStatus,
    lastCfRay: headers.get("cf-ray") ?? jar.lastCfRay,
  };
}

export function absorbDocumentCookies(
  jar: MasseyHeaderJar,
  documentCookie: string,
  domain: string,
  path: MasseyHeaderJar["path"],
): MasseyHeaderJar {
  const incoming = cookiesFromDocumentCookie(documentCookie, domain);
  if (!incoming.length) return { ...jar, path, updatedAtMs: Date.now() };
  return {
    ...jar,
    updatedAtMs: Date.now(),
    path,
    cookies: mergeCookies(jar.cookies, incoming),
  };
}
