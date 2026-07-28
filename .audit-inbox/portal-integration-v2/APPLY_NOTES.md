# Portal Skills v2 — Apply Notes

## Apply

```bash
cd /Users/nolarose/Projects
git apply /Users/nolarose/Projects/Kalshi-bot/.audit-inbox/portal-integration-v2/portal-skills-v2.patch
```

Verified: `git apply --check` passes from `/Users/nolarose/Projects`.

## Files

| File | Change |
|---|---|
| `lib/http/skills-catalog.ts` | +`lineCount`/`resources`/`validation` per entry; +`buildSkillDetail()`; +`packageSkill()` (zip CLI + sha256, typed `SkillPackageError`); +`skillPackageExists()` |
| `lib/http/portal-skill-detail.ts` | **new** — `PORTAL_MARKDOWN_PARSER`, `renderSkillDetailPage()`, `renderSkillNotFoundPage()` |
| `scripts/serve-public.ts` | +routes: `GET /api/skills/:name`, `POST /api/skills/:name/package` (publish-gated), `GET /portal/skills/:name` (server-rendered) |
| `public/portal/skills/index.html` | name links to detail page; Lines/Resources/Valid columns; warnings stat card |

## Restart

Route changes are in `serve-public.ts` — **restart the server** after applying.

## Verify

```bash
# Catalog with new fields
curl -s localhost:<port>/api/skills | jq '.skills[0] | {name, lineCount, resources, validation}'

# Detail JSON
curl -s localhost:<port>/api/skills/automation | jq '{name, lineCount, files: (.files|length)}'

# 404 JSON
curl -s localhost:<port>/api/skills/no-such-skill | jq .

# Detail page (HTML)
curl -s localhost:<port>/portal/skills/automation | head -20

# Package — publish-gated (expect 401/503 without token)
curl -s -X POST localhost:<port>/api/skills/automation/package | jq .
curl -s -X POST -H "Authorization: Bearer $REGISTRY_PUBLISH_TOKEN" \
  localhost:<port>/api/skills/automation/package | jq .
# Then: curl -sI localhost:<port>/skills/automation.skill
```

## Notes

- Read auth whitelist: `/api/skills` prefix already covers the new sub-routes; `/portal/` covers the detail page. No whitelist changes needed (comment added).
- Packaging is fail-closed behind `requirePublishAuth` (`decidePublishAuth`).
- Skill names are regex-gated (`^[a-z0-9-]{1,64}$`) before any filesystem access — path-traversal-proof.
- Smoke runner: `bun .audit-inbox/portal-integration-v2/smoke/skills-catalog-smoke.ts` (read-only against the real skills dir).
