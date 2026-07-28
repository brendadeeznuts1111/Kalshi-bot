# Portal Skills surface — apply notes

Adds a **Skills** surface to the local portal (`scripts/serve-public.ts`, port 3000):

- `GET /api/skills` — JSON catalog scanned from `PORTAL_SKILLS_DIR`
  (default: Kimi Work managed skills dir) with minimal YAML-frontmatter parsing
  (name / description, incl. `description: >` folded blocks), file mtime, and a
  `hasPackage` flag when `public/skills/<name>.skill` exists
  (override via `PORTAL_SKILLS_PACKAGES_DIR`). Missing/inaccessible dirs return
  HTTP 200 with `{ skills: [], count: 0, error, warning }` — never a crash.
- `GET /portal/skills` (+ trailing slash) — portal page rendering the catalog as
  a table with `.skill` download links (served statically from `public/skills/`).
- Nav link added to every `public/portal/*/index.html` page and `_page-template.html`
  (dropdown, right after Catalog).
- Markdown alternate: `skills` added to `PAGES` (portal-markdown.ts),
  `PORTAL_MD_SLUGS` + llms.txt bullet (llms-txt.ts), and the
  `withMarkdownAlternate` regex in serve-public.ts.
- `/portal/skills/` added to `PORTAL_DASHBOARD_ROUTES` (lib/http/public-routes.ts)
  for tools/verify-portal.ts.
- `/api/skills` added to the public read-path list (alongside `/api/catalog`).
- `public/portal/skills/index.html` added to `WATCH_PATHS` for live-reload.

## Apply

From the upstream root (`/Users/nolarose/Projects`):

```sh
git apply --check Kalshi-bot/.audit-inbox/portal-integration/portal-skills.patch   # verified OK
git apply        Kalshi-bot/.audit-inbox/portal-integration/portal-skills.patch
```

## Binary package drop (NOT in the patch)

The `.skill` archive is binary and not carried by the patch. Copy it manually:

```sh
cp Kalshi-bot/partner-gateway-integrator.skill public/skills/partner-gateway-integrator.skill
```

Drop any other `<name>.skill` archives into `public/skills/` the same way — the
`hasPackage` flag and the download link appear automatically. Files under
`public/skills/` are downloadable for free via the generic `staticFile()` path
(`/skills/<name>.skill`).

## Verify

```sh
bun scripts/serve-public.ts &
curl -s localhost:3000/api/skills | head -c 600          # { "skills": [...], "count": N }
curl -s localhost:3000/portal/skills/ | grep -i skills   # HTML page
curl -s -H 'Accept: text/markdown' localhost:3000/portal/skills.md
curl -sI localhost:3000/portal/skills/ | grep -i 'link:' # markdown alternate header
curl -sO localhost:3000/skills/partner-gateway-integrator.skill
bun tools/verify-portal.ts                                # includes /portal/skills/
```
