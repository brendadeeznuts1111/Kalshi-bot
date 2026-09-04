# Massey fetch · Bun 1.4 / 1.4.1

The CVOL live table is Cloudflare-fronted. Native `fetch` returns 403 / "Just a moment" unless a prior WebView session left clearance cookies. This pass does **not** solve challenges. It caches the cookies and headers a real WebView already earned and replays them on the fast path.

odds-heat `a50ba6e` still holds the simulated CVOL priors. Live 350-row ingest stays on Kalshi-bot `massey:sync`.

## What was wrong

- `fetch.ts` on main sent only `User-Agent` + `Accept`. No `Cookie`, no client hints, no `Accept-Language`.
- WebView used the default **ephemeral** dataStore. Every process paid a fresh challenge.
- Native breaker never reset after a WebView success, so the rest of a multi-sport run stayed on WebView (~4s each).
- Proxy only via `Bun.env`. Bun 1.4 `fetch({ proxy: { url, headers } })` was unused, so CONNECT `Proxy-Authorization` never went on the tunnel.
- Chrome CDP (`Network.enable`, UA override, extra headers) ran **before** the first `navigate()`. Bun WebView docs: that throws `ERR_INVALID_STATE` and the catch swallowed it.
- A new `Bun.WebView` per sport. 1.4.1 WebKit hung `navigate()` after ~64 views.
- `absorbSetCookieHeaders` read `headers.get("status")` — that is not the HTTP status.

## Bun contract (release notes + docs)

| Fact | Source | Rule here |
| --- | --- | --- |
| `Bun.WebView` is built-in; chrome via CDP, webkit on macOS | [Bun 1.4](https://bun.com/blog/bun-v1.4) | chrome off Darwin; webkit on Darwin |
| `dataStore: { directory }` persists cookies / localStorage | [WebView docs](https://bun.com/docs/runtime/webview) | `research/cache/massey-webview` |
| Views that share a directory share cookies; first chrome view owns `--user-data-dir` | WebView docs | one process-level view + one profile |
| `cdp()` before the first `navigate()` → `ERR_INVALID_STATE` | WebView docs | `about:blank` → CDP prime → Massey URL |
| Header name casing is preserved on the wire | Bun 1.3.7 / 1.4 | send `User-Agent`, not `user-agent` |
| `HTTP_PROXY` / `HTTPS_PROXY` re-read at runtime | Bun 1.3.12 | `applyMasseyProxyEnv` before each native fetch |
| `fetch({ proxy: { url, headers } })` sends headers on CONNECT | [Fetch docs](https://bun.com/docs/runtime/networking/fetch) | `masseyFetchProxyOption` |
| HTTPS through a proxy reuses CONNECT tunnels | Bun 1.4 | one overlay proxy, many sports |
| TLS is checked against the **URL host**, not `Host` | [Bun 1.4.1](https://bun.com/blog/bun-v1.4.1) | never spoof `Host` |
| `tls.checkServerIdentity` opened a new TLS conn per request (1.4.0 regression) | 1.4.1 fix | pin Bun ≥ 1.4.1 |
| WebKit hung `navigate()` after 64 views / chrome `url:` close rejection | 1.4.1 | reuse one view; only close ephemeral |
| `fetch` timeout ≤ 4s aborted early (1.4.0 regression) | 1.4.1 | native timeout stays 15s |

House rules still apply: Bun ≥ 1.4.1, no `[permissions] secure` in shared bunfig, `--no-env-file --no-orphans` on the worker, proxy URL in env not in git.

## Path

```
native fetch
  headers = masseyRequestHeaders(jar)   // UA + hints + Cookie, Host never set
  proxy   = masseyFetchProxyOption()    // CONNECT headers, optional
  HTTPS_PROXY overlay applied (1.3.12 re-read)
    | 200 + table? → HTMLRewriter → done; reset breaker
    | 403 / challenge / no table → breaker++; absorb Set-Cookie anyway
    v
shared Bun.WebView({ dataStore: massey-webview profile })
    navigate(about:blank)               // required before cdp()
    chrome: Network.enable
            Emulation.setUserAgentOverride
            Network.setExtraHTTPHeaders
            Network.setCookie per jar cookie
    navigate(massey url)
    poll title until not "Just a moment"
    extract table + document.cookie
    Network.getCookies({ urls })        // HttpOnly clearance
    write research/cache/massey-headers.json
    reset breaker
    keep the view open for the next sport
```

## Env

```
MASSEY_HTTPS_PROXY=http://127.0.0.1:8888
MASSEY_HTTP_PROXY=
MASSEY_NO_PROXY=localhost,127.0.0.1
MASSEY_PROXY_AUTHORIZATION=Basic dXNlcjpwYXNz
MASSEY_PROXY_HEADER=
```

Do not commit a proxy URL or a token. Do not set a fake `Host`. Do not ship a challenge solver. Do not disable TLS.

## Run

```
bun test --isolate tests/institutions/massey/headers.test.ts
bun run massey:sync -- --sport=cvol/ncaa-d1 --write --rows=5
```

First run on a challenged network still needs WebView + a displayable Chrome/WebKit. Later runs in the same 12h window should hit native fetch if `cf_clearance` is still valid.
