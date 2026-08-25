# License Gate — Operator's Manual

Probe-verified against Bun 1.4.0 and the committed tooling (2026-08-24);
§95 of AGENT-PITFALLS.md records the corrections. Policy changes live in
config files ONLY — never patch the TypeScript for allowlist/alias/
exemption decisions.

## What runs where

- Pre-commit hook (`.githooks/pre-commit` -> `tools/pre-commit.ts`):
  `licenses:gate` fires as a CONDITIONAL gate when a staged path touches
  package.json, bun.lock, config/licenses-allowlist.json, config/
  audit-overrides.json, tools/licenses-gate.ts, tools/audit-overlay-
  update.ts, or src/lib/licenses-policy.ts. A new prod dependency or a
  policy edit fails the COMMIT if the license is not permissive or not
  exempted. Everything else (guard, typecheck, tests, glossary, breaking-
  audit, deps:check, docs:check, ...) runs as before.
## Operating rhythm (the four touchpoints)

- WEEKLY (or pre-release): `bun run audit:overlay:update` — the one
  network call in the system; the gate itself stays offline. Then run
  `bun run licenses:gate` and read the human output for new `warn
  advisory` lines.
- NEW PROD DEPENDENCY: `bun run licenses:gate --json` to preview the
  verdict. If blocked, add an exemption (name/license/version scope,
  `expires`, `remediation`) to config/licenses-allowlist.json — never
  patch the TypeScript.
- BEFORE A MAJOR RELEASE: `bun run licenses:sbom` and review the diff
  printed to STDOUT (added / removed / changed lines). The file
  .data/licenses-sbom.json holds the SNAPSHOT only — it has no
  added/removed/changed arrays, and `git diff` on it shows little more
  than generatedAt churn. The diff you want is the gate's own output.
- EXEMPTION EXPIRY: the gate fails with an explicit
  "Action: <remediation>" hint. Re-evaluate the vendor/package, then
  remove the exemption (a license-scoped one drops itself when a real
  license appears) or extend `expires` with a fresh note — never
  silently re-approve.

- Full merge proof: `bun run check` (same as `bun run bun:ci`) runs all
  17 verify:contracts gates every time — this is the authority; the
  pre-commit hook is the fast subset.

## Adding a new production dependency

1. `bun add <package>` and stage the lockfile. The pre-commit hook now
   runs the gate automatically.
2. Want a preview first? `bun run licenses:gate --json` shows the full
   per-package verdict before you commit.
3. If the gate blocks, the human output ends with:

```
  FAIL some-lib@2.0.0 — no allowlist entry and no matching exemption
licenses:gate — FAIL (1 violation(s))
```

   (`--json` carries the same as a `violations` array with the reason.)

4. Fix it in config/licenses-allowlist.json — the field is `name`, NOT
   `pkg` (the schema validator rejects a missing name):

```json
{
  "policy": {
    "allowedLicenses": ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "Unlicense", "CC0-1.0"],
    "licenseAliases": { "BSD": "BSD-3-Clause", "Apache 2.0": "Apache-2.0" }
  },
  "exemptions": [
    {
      "name": "some-lib",
      "version": "2.0.0",
      "license": "GPL-3.0",
      "expires": "2026-12-31",
      "remediation": "legal approved this specific version; upgrade when MIT releases"
    }
  ]
}
```

   - `license` scopes the exemption: it applies ONLY while the reported
     license equals it. A future version with a different license stops
     matching automatically — no grandfathering.
   - `version` is an exact match on the RESOLVED version. For file: deps
     bun reports the file spec (e.g. `vendor/proton-pass`), not semver —
     so vendored exceptions rely on license-scoping + `expires`, not
     `version`.
   - `expires` is the time-bomb: an expired exemption FAILS the gate and
     prints `Action: <remediation>`.

5. Re-run `bun run licenses:gate` to confirm green, then commit.

## Mis-mapped license strings (aliases)

- The alias map lives at `policy.licenseAliases` (NOT a top-level
  `aliases` key). Matching is case-insensitive with a passthrough for
  unknown strings — 'GPL-3.0' is never silently normalized.
  Example entry: `"BSD": "BSD-3-Clause"`.
- An identity alias like `"Unlicense": "Unlicense"` is a no-op —
  Unlicense is already in allowedLicenses.
- Pseudo-license strings get actionable reasons (they still FAIL):
  UNLICENSED -> 'not open source; remove the dep or get an explicit
  vendor/legal exemption'; 'SEE LICENSE IN <file>' -> 'resolve manually
  and add an exemption'.
- SPDX 'WITH' exceptions evaluate the BASE license: 'MIT WITH
  LLVM-exception' passes; a WITH modifier never rescues a non-permissive
  base.


## Vulnerability overlay (warn-only)

- config/audit-overrides.json maps `pkg@version` -> severity (string
  shorthand or `{ severity, note? }`). Matches are printed as `warn
  advisory ...` in human output and appear in the `advisories` array of
  --json. The exit code NEVER changes for advisories — license policy is
  the merge authority.
- Refresh: `bun run audit:overlay:update` — the one network call in the
  system. Shells `bun audit --json` (returns `{}` when clean), upserts
  into the overlay, preserves manual entries. Run weekly or before a
  release — or let the cron-main weekly job do it (below).

## SBOM snapshots

- `bun run licenses:sbom` writes .data/licenses-sbom.json and prints the
  diff vs the previous snapshot (added / removed / changed lines). The
  DIFF LIVES IN STDOUT — the JSON file itself has no added/removed/
  changed arrays (those appear in `--json` output only when combined
  with `--sbom`).
- The file's `generatedAt` changes on every run, so `git diff .data/
  licenses-sbom.json` will always show that line — fingerprints (sha256
  of name|version|license|package.json) are stable across runs.

## Machine-readable output

- `bun run licenses:gate --json | jq '.ok'` — boolean pass/fail. There is
  NO `status` key (`jq '.status'` returns null).
- Top-level keys: ok, generatedAt, bunVersion, summary
  (total/allowed/violations/exemptions), packages, violations,
  advisories, expiringSoon, staleExemptions, diff.

## When an exemption expires

- Example (proton-pass, expires 2026-12-01): the gate fails with
  `FAIL @factorywager/proton-pass@vendor/proton-pass — exemption expired
  on 2026-12-01 — re-review ... Action: re-review vendor arrangement:
  upgrade to an upstream package with a declared license, or obtain
  written vendor approval`.
- Steps: (1) check whether the vendor released a version with a real
  license — if yes, the license-scoped exemption stops matching on its
  own; remove it from the config. (2) If not, extend `expires` and
  refresh `remediation` — forcing an intentional re-approval. Do NOT
  bump `version` for a file: dep (see above).

## Cheat sheet

| Command | Purpose |
| :--- | :--- |
| `git commit` | Runs pre-commit; licenses:gate fires on dep/policy changes |
| `bun run check` | Full merge proof — all 17 contract gates |
| `bun run licenses:gate` | Manual run, human-readable |
| `bun run licenses:gate --json` | Machine-readable verdicts (ok/summary/violations/advisories) |
| `bun run licenses:sbom` | Write snapshot + print diff vs previous |
| `bun run audit:overlay:update` | Refresh vulnerability overlay (network; warn-only) |
| edit `config/licenses-allowlist.json` | Allowlist, aliases, exemptions, expiry |


## SPDX expression licenses

- Compound licenses are evaluated: OR -> passes if ANY alternative is
  allowed ('(MIT OR Apache-2.0)' passes — you may comply with MIT);
  AND -> passes only if ALL are allowed ('MIT AND GPL-3.0' fails).
  Parentheses nest.
- Lowercase 'or' inside an id is not an operator — 'GPL-2.0-or-later'
  is treated as a single (non-permissive) string, not a split.
- Failed expressions report `no permissive alternative: <expr>`.

## Expiry warning window

- policy.expiryWarningDays (default 30) turns the time-bomb into a
  countdown: exemptions expiring within the window print
  `warn exemption <name> expires in N day(s)` and appear in the
  expiringSoon array of --json. The exit code is unchanged — you get
  lead time to re-review, then the gate fails on the expiry date.

## Testing with an alternate config

- `bun run licenses:gate --config <path>` overrides the allowlist config
  (the test suite uses it to prove the failure path: a strict
  allowedLicenses ['MIT'] fixture makes the gate exit 1).
## Live compliance health (/status + ops dashboard)

- Every default-config gate run writes .data/licenses-state.json
  (ok/fails/packages/exemptions/advisories/expiringSoon). The signal
  pipeline surfaces it as the licenses-health signal on /status and the
  /ops dashboard: 'N prod packages · M violations'. Failing gate = bad
  severity; missing state = warn (run `bun run licenses:gate` to seed);
  stale > 30 days = warn.
- The /ops dashboard has a licenses:gate action button (offline, ~10ms)
  alongside docs:check/docs:api/...
- --config runs skip the state write — only the real policy seeds it.


## Cheat sheet additions

| Command | Purpose |
| :--- | :--- |
| `bun run licenses:gate --config <path>` | Run against a different policy file |
| `bun run licenses:gate --overlay <path>` | Test against an alternate audit-overrides.json |
## Release sign-off report

- `bun run licenses:report` writes research/outputs/licenses-report.md
  (gitignored — regenerate + attach at release time): summary, package
  table with license status + fingerprint, exemptions with expiry,
  advisories, expiring-soon, drift vs the previous snapshot, and any
  violations. The header carries a config fingerprint so the artifact
  proves which policy version produced it.
- A FAILING gate still writes the report (with the violations listed)
  and exits 1 — the FAIL state is exactly what legal needs to see.
- The weekly cron job regenerates it automatically alongside the overlay
  refresh.
## Compliance alerts (Telegram push)

- With `COMPLIANCE_ALERTS=1` on the weekly cron (plus TELEGRAM_* and
  subscribers), the job PUSHES a summary when something needs
  attention: new advisories, a failing gate, or exemptions entering the
  expiry warning window. Deduped by content fingerprint — a stable
  situation is not re-sent weekly; any change alerts once.
- The platform is no longer purely reactive: it pings you instead of
  waiting to be asked.


| `bun run licenses:report` | Write the markdown compliance report (legal/release sign-off) |
## Live channels

- Compliance signals live on their OWN 'Compliance' dashboard channel
  (licenses-health), not hidden in Docs — /status + /ops dashboard show
  it as a first-class section.

## XML SBOM twin

- `bun run licenses:report` also writes research/outputs/
  licenses-sbom.xml — CycloneDX 1.5, generated with the probed Bun.XML
  API. Same gate data as the markdown report: components with bom-ref,
  license id/name, kalshi-bot status properties, and a metadata block
  with the gate status + config fingerprint. Well-formedness is tested
  via XML.parse round-trip.

| `bun run licenses:report` | Write markdown report + CycloneDX XML SBOM |




## Config schema reference additions

- policy.expiryWarningDays: non-negative integer, default 30.

## Config schema reference

- policy.allowedLicenses: non-empty array of canonical SPDX ids.
- policy.licenseAliases: loose spellings -> canonical id (case-
  insensitive match).
- exemptions[]: { name (required), license?, version?, reason?,
  remediation?, expires? (YYYY-MM-DD) }. Validated at load; a malformed
  config exits 1 with the exact message.
- config/audit-overrides.json: { format, version, advisories: {
  "pkg@version": "severity" | { severity, note? } } }.
