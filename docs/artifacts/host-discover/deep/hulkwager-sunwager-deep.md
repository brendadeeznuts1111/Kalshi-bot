# Deep host-discover: hulkwager.com × sunwager.com

**Fetched:** 2026-08-09 (passive HTTP + DNS + CT; no SKINS edits)  
**Worktree:** `.worktrees/plive-event-meta-map/Kalshi-bot`  
**Method notes:** Shell/`openssl`/`dig` CLI unavailable in this session — DNS via Google DNS-over-HTTPS; TLS SANs via Cert Spotter CT API (`api.certspotter.com`). Bodies fetched via browser-like GETs; large redirect/error bodies truncated in analysis.

---

## Executive verdict

| Host | Family guess | Guess confidence | Tool / passive confidence | Notes |
| --- | --- | ---: | ---: | --- |
| **www.hulkwager.com** | **buckeye** | **0.90** | 0.95 (signals observed) | Same CF NS pair as `fantasy402.com`; Ultra path returns **401** (exists); `sites/<host>/` + RequireJS sign-in shell. |
| **sunwager.com** | **metallic** | **0.88** | 0.95 (signals observed) | Same CloudNS NS quartet as `paradisewager.com` / `orange777.com`; path stack matches metallic player shell; **shared TLS SAN + A with gator747**. |
| **gator747.com** | **metallic** (same sub-cluster as sunwager) | **0.92** | 0.98 | Byte-identical A pair + multi-SAN cert with sunwager; same login/PWA surface. |

**Guess confidence** = belief the skin-family label is correct for a future SKINS map.  
**Tool confidence** = belief the observed passive facts are real (not that mapping is finalized).

Neither host emits literal tokens `buckeye` / `metallic` in public HTML/CSS/JS. Family assignment is by **stack fingerprint + infra co-tenancy**, not brand strings.

**Mapped 2026-08-09** into `SKINS[].hosts` (suggest→confirm):
- `hulkwager.com` / `www.hulkwager.com` → **buckeye**
- `sunwager.com` / `www.sunwager.com` → **metallic**
- `gator747.com` / `www.gator747.com` → **metallic** (SAN/A twin of sunwager)

Live-product offerings still TBD for metallic; buckeye keeps declared plive/ezlive.

---

## 1) First-party URLs from inventories

### www.hulkwager.com (`www.hulkwager.com-urls.json`, confidence 0.09 → unknown)

| URL |
| --- |
| `https://www.hulkwager.com/js/require.js` |
| `https://www.hulkwager.com/login` |
| `https://www.hulkwager.com/sites/hulkwager.com/css/bootstrap.min.css` |
| `https://www.hulkwager.com/sites/hulkwager.com/css/signin.css` |
| `https://www.hulkwager.com/sites/hulkwager.com/images/favicon.ico` |
| `https://www.hulkwager.com/sites/hulkwager.com/images/logo.png` |

Third-party (context only): jquery 1.11.1 (code.jquery.com), bootstrap license/docs refs, requirejs.org.

### sunwager.com (`sunwager.com-urls.json`, confidence 0.05 → unknown)

| URL |
| --- |
| `https://sunwager.com/css/styles.css?v=1.2` |
| `https://sunwager.com/flash/banner.html` (+ `?m=1`) |
| `https://sunwager.com/icons/icon-{72,96,128,144,152,192,384,512}x{…}.png` |
| `https://sunwager.com/main.html` |
| `https://sunwager.com/manifest.webmanifest` |
| `https://sunwager.com/player-api/identity/CustomerLoginRedir?RedirToHome=1` |
| `https://sunwager.com/webapp-banner.png` |
| `https://sunwager.com/webapp-banner-android.png` |
| SVG icon fragments `#icon-*` |

Third-party: cdnjs jquery 3.5.0 + jquery-validate 1.19.1, Google Fonts Heebo.

---

## 2) Deeper fetch status matrix

UA: Chrome-like desktop. Soft-404 copy on metallic hosts = “Hello! We have upgraded our website…” (Tech Department).

### hulkwager

| Path | Status / result |
| --- | --- |
| `/` | **200** — Bootstrap `form-signin` login (USERNAME/PASSWORD), logo under `sites/hulkwager.com/images/` |
| `/login` | **404** (fetch tool; inventory still lists `/login` — root *is* the login) |
| `/main.html` | **404** |
| `/v2/` | **404** |
| `/manifest.webmanifest` | **404** |
| `/manifest.json` | (not separately confirmed; treat as absent given webmanifest 404) |
| `/js/require.js` | **200** — RequireJS **2.1.11** |
| `/sites/hulkwager.com/css/signin.css` | **200** — `.form-signin`, gradient `#e0382c`→`#f9ae00` (same recipe as fantasy402 signin.css) |
| `/sites/hulkwager.com/` | **403** — `openresty` |
| `/player-api/` | **404** |
| `/cloud/api/Provider/getUltraLiveURL` | **401 Unauthorized** ← endpoint **present** |
| Fantasy402 control: same Ultra path | **401** |

### sunwager

| Path | Status / result |
| --- | --- |
| `/` | **200** — “Webapp installation instructions” (PWA install chrome) |
| `/main.html` | **200** — same install chrome / login surface |
| `/login` | Soft **404** (upgraded-site page) |
| `/v2/` | **200** — “Login ID / Password” + “Please enable JavaScript…” |
| `/manifest.webmanifest` | **500** (broken/misconfigured; orange777 same) |
| `/css/styles.css?v=1.2` | **200** — Heebo, `.login__form`, yellow/teal sun theme |
| `/flash/banner.html` | **200** (empty/minimal) |
| `/player-api/identity/CustomerLoginRedir?RedirToHome=1` | Large Chromium interstitial body (~126KB) — auth/redirect edge, not a literal brand dump |
| `/sites/sunwager.com/` | Soft **404** (metallic soft-404 copy) |
| `/cloud/api/Provider/getUltraLiveURL` | Soft **404** (same copy as orange777 / paradisewager) |
| Orange777 / Paradisewager Ultra control | Soft **404** (identical copy) |

### gator747 (relevance)

| Path | Status / result |
| --- | --- |
| `/` | Login ID/Password + “Webapp installation instructions” |
| `/main.html` | Same surface |
| `/manifest.webmanifest` | **500** (same as sunwager/orange777) |
| `CustomerLoginRedir` | Same large interstitial pattern as sunwager |

---

## 3) String hunt (case-insensitive)

Searched across fetched HTML/CSS/JS and redirect bodies for:  
`buckeye`, `metallic`, `ace`, `sts`, `magnum`, `lvaction`, `1bv`, `fantasy402`, `fantasy`, `ultra`, `getUltraLiveURL`, `player-us`, `sportswidgets`, `betfactory`, `CustomerLoginRedir`, `signin`, `tenant`, `brand`, `skin`, `partner`, `white.?label`, `plive`, `ezlive`, `paradis`, `orange777`, `wagerattack`, `requirejs`, `sites/`.

| Token / pattern | hulkwager | sunwager | Interpretation |
| --- | --- | --- | --- |
| `sites/` | **yes** (`sites/hulkwager.com/…`) | no (soft-404 if forced) | Buckeye white-label path |
| `requirejs` / RequireJS | **yes** (`/js/require.js` 2.1.11) | no | Buckeye login AMD loader |
| `signin` / `.form-signin` | **yes** (CSS) | no | Bootstrap sign-in template |
| `CustomerLoginRedir` / `player-api` | no | **yes** (inventory + fetch) | Metallic player identity API |
| `manifest.webmanifest` / PWA icons | no | **yes** | Metallic webapp shell |
| `main.html` | 404 | **yes** | Metallic entry |
| `getUltraLiveURL` (live path) | **401** | soft-404 | Buckeye Ultra API vs metallic absence |
| Literal `buckeye` / `metallic` / `fantasy402` / `plive` / `ezlive` / `orange777` / `paradise` | **not in public bodies** | **not in public bodies** | No brand-string smoking gun |
| `ace` / `sts` / `magnum` / `lvaction` / `1bv` / `wagerattack` | no | no | Not those families by string |

---

## 4) Infra

### DNS summary

| Name | A | AAAA | CNAME | NS | TXT |
| --- | --- | --- | --- | --- | --- |
| hulkwager.com | `104.18.42.196`, `172.64.145.60` (CF) | `2606:4700:…` (CF) | — | **`aiden.ns.cloudflare.com`**, **`tricia.ns.cloudflare.com`** | none (SOA only) |
| www.hulkwager.com | same CF pair | (CF) | none published | (apex) | — |
| sunwager.com | **`64.187.135.141`**, **`64.187.136.1`** | none | — | **`dns3/4/7/8.cloudns.net`** | none |
| www.sunwager.com | **same** as sunwager | none | none published | (apex) | — |
| gator747.com | **same A as sunwager** | — | — | **same CloudNS quartet** | — |
| fantasy402.com | `104.18.40.28`, `172.64.147.228` (CF) | none in DoH answer | — | **same aiden/tricia as hulkwager** | — |
| betwest.com | `185.207.199.122` | — | — | CF (`langston`/`ivy`) — different pair | — |
| paradisewager.com | `64.187.137.14`, `64.187.135.94` | — | — | **same CloudNS quartet** | — |
| orange777.com | `64.187.135.51`, `64.187.137.49` | — | — | **same CloudNS quartet** | — |

**NS coincidence is decisive:**

- Buckeye reference `fantasy402.com` and target `hulkwager.com` share the **identical Cloudflare nameserver pair** (`aiden` + `tricia`).
- Metallic references `paradisewager.com` / `orange777.com` and targets `sunwager.com` / `gator747.com` share the **identical CloudNS quartet**.

A-records: sunwager ≡ gator747 (exact). Paradise/orange sit in the same `64.187.x` provider block but not the same VIP.

### TLS / SAN (Cert Spotter CT; openssl CLI skipped)

| Cert subjects (dns_names) | Implication |
| --- | --- |
| `*.hulkwager.com`, `hulkwager.com` only | Solo apex; **not** co-signed with fantasy402 |
| `fantasy402.com`, `*.fantasy402.com` only | Solo apex (typical buckeye per-host CF cert) |
| **`gator747.com`, `sunwager.com`, `www.gator747.com`, `www.sunwager.com`** | **Hard co-tenancy** — one metallic sub-cluster |
| orange777 multi-SAN (~11 brands: vodka77, winwon99, …) | Separate metallic multi-brand cert |
| paradisewager multi-SAN (~30+ brands: sweat.ag, fantasy702, …) | Separate (larger) metallic multi-brand cert |

Sunwager is **not** listed on the orange777 or paradisewager SANs, but shares DNS authority + IP class + app path fingerprints with metallic. Treat as a **small metallic sibling cluster** (sunwager ↔ gator747), not an orange/paradise SAN-mate.

### Contrast (other skins)

- **sts** (`wagerattack.ag`): marketing SPA / websuite — unrelated path set.
- **ace** (`parlay21.com`): simple member login + product tiles — not `sites/` and not `player-api` PWA.

---

## 5) HTML / template structure diff

| Feature | buckeye (fantasy402) | **hulkwager** | metallic (orange777) | **sunwager** | paradisewager |
| --- | --- | --- | --- | --- | --- |
| Entry | `/` or `/login` Bootstrap sign-in | `/` Bootstrap sign-in | `/main.html` + PWA | `/` + `/main.html` PWA | `/main.html` Enabled theme |
| Asset root | `/sites/<host>/css|images` | `/sites/hulkwager.com/…` | `/style.css`, `/icons/` | `/css/styles.css`, `/icons/` | `/dist/min.css`, `/app/icons/` |
| JS loader | RequireJS + jQuery 1.11 | RequireJS + jQuery 1.11 | jQuery 3.5 + validate | jQuery 3.5 + validate | dist bundles |
| Form classes | `.form-signin` | `.form-signin` | `.login__form` / Login ID | `.login__form` + Heebo | Enabled “Login / Sign Up” |
| PWA | no | no | manifest + icon set + webapp banners | same | `_manifest.json` + install prompts |
| Identity API | Ultra (`getUltraLiveURL`) | Ultra **401** | `player-api/…/CustomerLoginRedir` | same | same |
| Ultra path | 401 | **401** | soft-404 | soft-404 | soft-404 |
| Title / brand chrome | host-centric | `WWW.HULKWAGER.COM` © 2022 | orange theme | sun yellow/teal (`#fb0`/`#089`) | Paradise marketing |

**Template conclusion:** hulkwager is a **reskinned buckeye RequireJS/Bootstrap sign-in**; sunwager is a **reskinned metallic PWA/player shell** (closer to orange777’s structure than paradisewager’s Enabled marketing theme, but same family infra).

---

## 6) Evidence table

| Signal | Supports | Strength |
| --- | --- | --- |
| NS `aiden`+`tricia` shared with fantasy402 | buckeye ← hulkwager | **very high** |
| `GET …/getUltraLiveURL` → **401** (same as fantasy402) | buckeye ← hulkwager | **very high** |
| `/sites/<host>/css/signin.css` + `.form-signin` + `#e0382c`→`#f9ae00` | buckeye ← hulkwager | **high** |
| RequireJS 2.1.11 at `/js/require.js` + jQuery 1.11 inventory | buckeye ← hulkwager | **high** |
| No `main.html` / PWA / `player-api` on hulkwager | against metallic | **high** |
| CloudNS `dns3/4/7/8` shared with paradise + orange | metallic ← sunwager | **very high** |
| A `64.187.135.141` + `64.187.136.1` ≡ gator747 | metallic cluster ← sunwager | **very high** |
| CT SAN `{sunwager,gator747}×{apex,www}` | metallic co-tenant | **decisive** |
| Paths: `main.html`, `CustomerLoginRedir`, icons, webapp banners | metallic ← sunwager | **high** |
| Ultra path soft-404 copy ≡ orange/paradise | metallic ← sunwager | **high** |
| `/v2/` JS login shell on sunwager | metallic player stack | **medium** |
| Literal brand strings buckeye/metallic/fantasy402 | — | **absent** (neutral) |
| Shared SAN with fantasy402 or orange/paradise multi-certs | — | **absent** for these two targets |

---

## 7) What is still missing for a SKINS map

Do **not** edit SKINS until an operator confirms. Gaps:

1. **Authenticated Ultra probe** on hulkwager — prove `stream-list` / Pandora / live-product set matches buckeye (`plive`/`ezlive`), not just anonymous 401 on `getUltraLiveURL`.
2. **Mapper for metallic** — sunwager/gator747/orange/paradise still `mapper.kind = unmapped`; need a live-product discovery path before offerings can be declared.
3. **Logged-in HAR** for both hosts (inventory `harPath: null`) — would catch post-login hostnames (`player-us`, sportswidgets, etc.).
4. **Operator naming** — whether sunwager/gator747 should be new hosts on `metallic` or a separate SkinId if desk ownership differs despite shared stack.
5. **Live openssl SAN dump** — CT covers recent issuances; re-run `openssl s_client` when CLI is available for currently presented leaf.
6. **crt.sh** — timed out / noisy; Cert Spotter already supplied usable SANs.

Suggested (non-applied) SKINS host candidates after confirmation:

- `buckeye.hosts` += `hulkwager.com`, `www.hulkwager.com`
- `metallic.hosts` += `sunwager.com`, `www.sunwager.com`, and almost certainly `gator747.com`, `www.gator747.com`

---

## 8) gator747 status

**gator747.com is the twin of sunwager.com**, not a separate unknown stack:

- Identical A records  
- Identical CloudNS authority  
- Shared TLS certificate SANs  
- Same metallic login / PWA / `main.html` / broken `manifest.webmanifest` (500) pattern  

Any SKINS decision for sunwager should decide gator747 in the same commit/lane.

---

## Appendix — control comparison one-liners

```
fantasy402  NS=aiden+tricia  Ultra=401  sites/=yes
hulkwager   NS=aiden+tricia  Ultra=401  sites/=yes   → buckeye ~0.90

orange777   NS=cloudns×4     Ultra=soft404  player-api=yes
paradise    NS=cloudns×4     Ultra=soft404  player-api=yes
sunwager    NS=cloudns×4     Ultra=soft404  player-api=yes  A≡gator747  SAN≡gator747 → metallic ~0.88
gator747    NS=cloudns×4     (same) → metallic ~0.92
```
