# Gate Pattern — checklist for adding a new contract gate

Distilled from licenses:gate §92-§101 (the repo's reference gate). Apply
this shape to any future gate so it lands with the same guarantees:
config-driven policy, fail-closed, importable, tested, documented.

## 1. Policy is config, not code

- All allow/deny/warn decisions read from a JSON config (e.g. config/
  licenses-allowlist.json) — operators change policy without touching
  TypeScript. Validate the config shape at load and exit 1 with the
  exact message on malformed input.
- Scoped, expiring exceptions (exemptions with license/version scope +
  expires + remediation) beat blanket carve-outs: a scoped exception
  stops matching automatically when reality changes.

## 2. Fail closed, and name the failure

- Check subprocess exit codes (resolveLicensesData §100): a toolchain
  failure must NOT masquerade as 'could not parse'. Distinguish
  'tool exited N' from 'output was not JSON'.
- Every failure mode gets a distinct, actionable message — and the
  operator-visible formats are asserted by an e2e test using a strict
  fixture (allowedLicenses ['MIT'] -> 'FAIL drizzle-orm@0.45.2').

## 3. Importable tool, guarded main

- Export the work function (refreshAuditOverlay, resolveLicensesData)
  behind `if (import.meta.main)` so cron jobs and tests can call it
  in-process. Throwing (not process.exit) from the exported fn keeps
  in-process callers alive (§99).
- Warnings (advisories, expiry windows) NEVER change the exit code —
  the gate's policy verdict is the merge authority; warnings are
  advisory channels.

## 4. Wire the full chain

- verify:contracts (unconditional) + pre-commit CONDITIONAL gate on the
  paths that matter (manifest + policy + tooling, §95).
- State file (.data/<name>-state.json via writeDocsGateState) ->
  signal-pipeline gate() -> /status + /ops dashboard action (§97).
- A cron slot in scripts/cron-main.ts for refresh jobs (opt-in env,
  tz UTC) — never a second ad-hoc scheduler shape (§99).

## 5. Tests: unit the lib, e2e the failure path, fixture the config

- Pure lib logic: unit tests (no subprocess).
- Failure path: e2e via --config/--overlay fixtures (the gate must
  actually BLOCK, not just report).
- Human output formats: asserted verbatim (the operator reads stdout).
- Network tools: no network tests — assert module shape + schedule
  instead (§99).
- Sign-off artifacts come in twins: human markdown + machine-readable
  (CycloneDX XML via the probed Bun.XML API, §103-§105), cross-linked by
  a CONTENT-ADDRESSED serial so a reviewer can verify the BOM matches
  exactly the policy + dependency set that produced it.

## 6. Documents

- AGENT-PITFALLS section: what was probed, what was corrected, the
  traps (each trap got a test).
- Operator's manual section: commands, exact failure formats, config
  schema, operating rhythm — one file away, not a chat artifact (§95).
