# Authorized Execution Demo Proof Schema

The graduation path is `tools/partner-execution-demo-collect.ts`. It captures
cursor-complete normalized Kalshi demo evidence, joins it to the out-wide SQLite
reservations, lifecycle, receipts, balance checkpoint, and immutable journal,
runs focused production-service recovery tests with mocked external I/O, and compiles the day
to redacted JSON and Markdown.

`tools/partner-execution-demo-proof.ts` is the lower-level compiler for
caller-supplied sanitized observations. It is useful for offline schema and
compiler validation, but its caller-supplied input is not authoritative
graduation evidence by itself. Both paths refuse `environment=prod`,
`KALSHI_ENV=prod`, or `KALSHI_PROD_ARMED=1`. Neither changes an environment
variable, execution flag, authorization, credential, or production-arm state.

## Input

The input JSON uses `DemoProofInput` from `src/partner/execution/demo-proof.ts`.
It contains only identifiers and numeric summaries for reservations, provider
orders/fills/positions, journal totals, receipt delivery, balance comparison,
and the six required scenario results. Raw provider responses, Telegram
payloads, credentials, cookies, and private keys are outside the schema and are
discarded by construction.

Required scenarios are:

1. duplicate requests produce one reservation/provider order;
2. crash after dispatch recovers through deterministic reconciliation;
3. timeout remains exposure-bearing unknown until conclusive evidence;
4. partial fill preserves its filled and remaining quantities;
5. cancellation is provider-confirmed and journaled;
6. Telegram outage leaves a durable receipt that delivers after recovery.

## Output

Each run writes `execution-demo-proof-YYYY-MM-DD.json` and `.md`. Schema version
2 includes:

- deterministic sanitized row arrays;
- reservation/order/fill/position and journal totals;
- orphan provider-order and confirmed-reservation counts;
- absolute provider-versus-local balance drift;
- account-wide provider-versus-local unsettled position drift;
- unknown-resolution SLA breaches and maximum unknown age;
- production environment and arming breaker evidence;
- SHA-256 provenance for normalized local, provider, and scenario evidence;
- maximum reconciliation and receipt lag;
- exercised/pass/evidence state for every required scenario;
- structural corroboration for duplicate IDs, reconciliation, partial fills,
  cancellation journal entries, and delayed receipt delivery (a caller-supplied
  `passed=true` cannot override missing structural evidence);
- a daily pass only when all scenarios pass, both orphan counts are zero, and
  balance drift is zero.

For an authoritative day, persist a balance checkpoint no later than the start
of that UTC proof day, then collect after provider evidence for the day exists:

```bash
bun run partner:execution:demo-collect -- \
  --partner=SPORTS --out=out-SPORTS-1 \
  --day=2026-08-07 --record-checkpoint
bun run partner:execution:demo-collect -- \
  --partner=SPORTS --out=out-SPORTS-1 \
  --day=2026-08-07
```

The collector covers every skin sharing the out/provider account and exits
nonzero for incomplete pagination, production evidence,
missing checkpoints, orphan/drift/SLA failures, or failed scenarios. Raw
credentials and provider payloads never enter the proof shape.

Run the lower-level compiler through its package command:

```bash
bun run partner:execution:demo-proof -- \
  --input=artifacts/demo-observations/2026-08-06.json \
  --output-dir=artifacts/execution-demo-proof
```

## Time-dependent graduation

A generated passing artifact proves only its represented demo day. Production
graduation still requires seven consecutive actual days of independently
captured demo evidence, zero unexplained/orphan orders, reviewed balance and lag
metrics, and an explicit human production-arm decision. This harness neither
simulates that elapsed time nor grants production approval.

After collecting exactly seven real daily artifacts, verify their content and
calendar continuity with repeated `--input` arguments:

```bash
bun run partner:execution:demo-graduation -- \
  --input=artifacts/execution-demo-proof/execution-demo-proof-2026-08-01.json \
  --input=artifacts/execution-demo-proof/execution-demo-proof-2026-08-02.json \
  --input=artifacts/execution-demo-proof/execution-demo-proof-2026-08-03.json \
  --input=artifacts/execution-demo-proof/execution-demo-proof-2026-08-04.json \
  --input=artifacts/execution-demo-proof/execution-demo-proof-2026-08-05.json \
  --input=artifacts/execution-demo-proof/execution-demo-proof-2026-08-06.json \
  --input=artifacts/execution-demo-proof/execution-demo-proof-2026-08-07.json
```

The verifier independently rechecks daily pass criteria, rejects missing,
duplicate, or nonconsecutive dates, constrains generation timestamps to their
daily windows, and writes a SHA-256 chain manifest. The chain detects later
artifact changes; it is not a signature and does not prove observation origin.
