# Authorized Execution Demo Proof Schema

`tools/partner-execution-demo-proof.ts` compiles one sanitized day of demo
observations into deterministic JSON and Markdown. It refuses `environment=prod`,
`KALSHI_ENV=prod`, or `KALSHI_PROD_ARMED=1`. It never changes an environment
variable, execution flag, authorization, credential, or production-arm state.

## Input

The input JSON uses `DemoProofInput` from
`src/partner/execution/demo-proof.ts`. It contains only identifiers and numeric
summaries for reservations, provider orders/fills/positions, journal totals,
receipt delivery, balance comparison, and the six required scenario results.
Raw provider responses, Telegram payloads, credentials, cookies, and private
keys are outside the schema and are discarded by construction.

Required scenarios are:

1. duplicate requests produce one reservation/provider order;
2. crash after dispatch recovers through deterministic reconciliation;
3. timeout remains exposure-bearing unknown until conclusive evidence;
4. partial fill preserves its filled and remaining quantities;
5. cancellation is provider-confirmed and journaled;
6. Telegram outage leaves a durable receipt that delivers after recovery.

## Output

Each run writes `execution-demo-proof-YYYY-MM-DD.json` and `.md`. Schema version
1 includes:

- deterministic sanitized row arrays;
- reservation/order/fill/position and journal totals;
- orphan provider-order and confirmed-reservation counts;
- absolute provider-versus-local balance drift;
- maximum reconciliation and receipt lag;
- exercised/pass/evidence state for every required scenario;
- structural corroboration for duplicate IDs, reconciliation, partial fills,
  cancellation journal entries, and delayed receipt delivery (a caller-supplied
  `passed=true` cannot override missing structural evidence);
- a daily pass only when all scenarios pass, both orphan counts are zero, and
  balance drift is zero.

Run through the package command:

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
