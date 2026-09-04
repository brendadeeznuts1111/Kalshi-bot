# Massey fetch · Bun 1.4 / 1.4.1

The CVOL live table is Cloudflare-fronted. Native `fetch` returns 403 / "Just a moment" unless a prior WebView session left clearance cookies. This pass does **not** solve challenges. It caches the cookies and headers a real WebView already earned and replays them on the fast path.

## What was wrong

- `fetch.ts` sent only `User-Agent` + `Accept`. No `Cookie`, no client hints, no `Accept-Language`.
- WebView used the default **ephemeral** dataStore. Every process paid a fresh challenge.
- Native breaker never reset after a WebView success, so the rest of a multi-sport run stayed on WebView (~4s each).
- No proxy overlay. Bun 1.3.12+ re-reads `HTTPS_PROXY` per `fetch()`, but we never set it.

## Bun contract (release notes)

| Fact | Source | Rule here |
| --- | --- | --- |
| `Bun.WebView` is built-in; chrome via CDP, webkit on macOS | Bun 1.4 | chrome off Darwin; webkit on Darwin |
| `dataStore: { directory }` persists cookies / localStorage | WebView docs | `research/cache/massey-webview` |
| Header name casing is preserved on the wire | Bun 1.3.7 / 1.4 | send `User-Agent`, not `user-agent` |
| `HTTP_PROXY` / `HTTPS_PROXY` re-read at runtime | Bun 1.3.12 | `applyMasseyProxyEnv` before each native fetch |
| HTTPS through a proxy reuses CONNECT tunnels | Bun 1.4 | one overlay proxy, many sports |
| TLS is checked against the **URL host**, not `Host` | Bun 1.4.1 | never spoof `Host` |
| `tls.checkServerIdentity` opened a new TLS conn per request (1.4.0 regression) | 1.4.1 fix | pin Bun ≥ 1.4.1 |
| WebKit hung `navigate()` after 64 views / chrome `url:` close rejection | 1.4.1 | reuse one view profile; `await using` still fine |
| `fetch` timeout ≤ 4s aborted early (1.4.0 regression) | 1.4.1 | native timeout stays 15s |

House rules still apply: Bun ≥ 1.4.0, no `[permissions] secure` in shared bunfig, `--no-env-file --no-orphans` on the worker, proxy URL in env not in git.

## Path

```
native fetch + cached Cookie + browser headers
    │ 200 + table? → HTMLRewriter → done; reset breaker
    │ 403 / challenge / no table → breaker++
    ▼
Bun.WebView({ dataStore: massey-webview profile })
    chrome: Network.enable + setUserAgentOverride + setExtraHTTPHeaders
    poll title until not "Just a moment"
    extract table + document.cookie (+ Network.getAllCookies on chrome)
    write research/cache/massey-headers.json
    reset breaker
```

## Env

```
MASSEY_HTTPS_PROXY=http://127.0.0.1:8888
MASSEY_HTTP_PROXY=
MASSEY_NO_PROXY=localhost,127.0.0.1
```

Do not commit a proxy URL. Do not set a fake `Host`. Do not ship a challenge solver.

## Run

```
bun test --isolate tests/institutions/massey/headers.test.ts
bun run massey:sync -- --sport=cvol/ncaa-d1 --write --rows=5
```

First run on a challenged network still needs WebView + Chrome/WebKit. Later runs in the same 12h window should hit native fetch if `cf_clearance` is still valid.
