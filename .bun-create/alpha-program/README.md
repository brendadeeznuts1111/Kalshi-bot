# Alpha program template (SSOT)

**Single source of truth** for tenant scaffolding. Edit files here; do not maintain a parallel copy under `src/alpha/`.

Birth a program only via:

```bash
bun create alpha-program alpha/<name> --no-git
```

Or:

```bash
bun src/calibration/init-program.ts kickoff-toss --dimension=sports-soccer
```

**First act:** complete `hypothesis.md` (five questions). **Shadow tick:** `bun src/run-once.ts --ticker=KX... --price=55`. **Calibration:** `bun run calibration:watcher`.

**Graduation gates:** `graduationMinRealizedEdgeCentsPerFill` (primary) + Brier sanity (`killBrierDriftPct` band). Brier at n=100 detects gross miscalibration only.

Institution imports (from `alpha/<name>/src/`): `../../../src/institutions/`.

Baseline engine (odds client, ticker mapper): [`src/alpha/`](../../src/alpha/).
