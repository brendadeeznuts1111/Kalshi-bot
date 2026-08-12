# Live-tracker analyze (tennis / live)

Generated `2026-08-12T02:00:43.419Z`

settlement + edge patterns · sport=tennis phase=live · sort-by severity,id · rows=6 · voidRisk[high=5 medium=1] · dualStamp=6/6 · mean voidΔ=-15.0 · schema v3

## Summary

| metric | value |
| --- | --- |
| rows | 6 |
| with voidEv | 4 |
| mean voidΔ | -15 |
| dual timeMs | 6/6 |
| voidRisk | high:5 · medium:1 |
| severity | high:5 · watch:1 |
| marketClass | match_ml:5 · period_ml:1 |

## Preset `desk`

| time | timeMs | eventType | period | marketType | from | to | voidRisk | maxSeverity | patternIds | pVoidPrior | sizingNote |
| --- | ---: | --- | --- | --- | ---: | ---: | --- | --- | --- | ---: | --- |
| 2026-08-10T10:00:01.000Z | 1786356001000 | MARKET_ADDED | m | 3 | — | — | high | high | void.live-ml-unfinished, fill.secondary-confirmation, phase.pre… | 0.15 | live match ML: high void on unfinished match — prefer completed set/gam… |
| 2026-08-10T10:00:02.000Z | 1786356002000 | PRICE_CHANGE | m | 3 | 1.9 | 1.95 | high | high | void.live-ml-unfinished, fill.secondary-confirmation, phase.pre… | 0.15 | live match ML: high void on unfinished match — prefer completed set/gam… |
| 2026-08-10T10:00:04.000Z | 1786356004000 | PRICE_CHANGE | m | 4 | 1.5 | 1.55 | high | high | void.live-ml-unfinished, fill.secondary-confirmation, phase.pre… | 0.15 | live match ML: high void on unfinished match — prefer completed set/gam… |
| 2026-08-10T10:00:05.000Z | 1786356005000 | PRICE_CHANGE | m | 3 | 1.95 | 1.88 | high | high | void.live-ml-unfinished, fill.secondary-confirmation, phase.pre… | 0.15 | live match ML: high void on unfinished match — prefer completed set/gam… |
| 2026-08-10T10:00:05.000Z | 1786356005000 | PRICE_CHANGE | m | 4 | 1.55 | 1.62 | high | high | void.live-ml-unfinished, fill.secondary-confirmation, phase.pre… | 0.15 | live match ML: high void on unfinished match — prefer completed set/gam… |
| 2026-08-10T10:00:03.000Z | 1786356003000 | MARKET_ADDED | s1 | 3 | — | — | medium | watch | fill.secondary-confirmation, phase.prematch-vs-live-product | 0.05 | size residual action path only · patterns: fill.secondary-confirmation |

## Preset `odds`

| time | eventType | period | marketType | selection | from | to | detail |
| --- | --- | --- | --- | --- | ---: | ---: | --- |
| 2026-08-10T10:00:01.000Z | MARKET_ADDED | m | 3 | — | — | — | market m/3 offered |
| 2026-08-10T10:00:02.000Z | PRICE_CHANGE | m | 3 | 1 | 1.9 | 1.95 | price m/3/1 1.9→1.95 |
| 2026-08-10T10:00:04.000Z | PRICE_CHANGE | m | 4 | 1 | 1.5 | 1.55 | price m/4/1 1.5→1.55 |
| 2026-08-10T10:00:05.000Z | PRICE_CHANGE | m | 3 | 1 | 1.95 | 1.88 | price m/3/1 1.95→1.88 |
| 2026-08-10T10:00:05.000Z | PRICE_CHANGE | m | 4 | 1 | 1.55 | 1.62 | price m/4/1 1.55→1.62 |
| 2026-08-10T10:00:03.000Z | MARKET_ADDED | s1 | 3 | — | — | — | market s1/3 offered |

## Preset `settlement`

| time | eventType | sportKey | phase | marketClass | actionThreshold | voidRisk | preferUnitMkts | pVoidPrior | pliveEqEzlive | sizingNote | summary |
| --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| 2026-08-10T10:00:01.000Z | MARKET_ADDED | tennis | live | match_ml | match_completed | high | true | 0.15 | true | live match ML: high void on unfinished match — prefer completed set/gam… | tennis · live · match_ml · action=match_completed · voidRisk=high · pre… |
| 2026-08-10T10:00:02.000Z | PRICE_CHANGE | tennis | live | match_ml | match_completed | high | true | 0.15 | true | live match ML: high void on unfinished match — prefer completed set/gam… | tennis · live · match_ml · action=match_completed · voidRisk=high · pre… |
| 2026-08-10T10:00:04.000Z | PRICE_CHANGE | tennis | live | match_ml | match_completed | high | true | 0.15 | true | live match ML: high void on unfinished match — prefer completed set/gam… | tennis · live · match_ml · action=match_completed · voidRisk=high · pre… |
| 2026-08-10T10:00:05.000Z | PRICE_CHANGE | tennis | live | match_ml | match_completed | high | true | 0.15 | true | live match ML: high void on unfinished match — prefer completed set/gam… | tennis · live · match_ml · action=match_completed · voidRisk=high · pre… |
| 2026-08-10T10:00:05.000Z | PRICE_CHANGE | tennis | live | match_ml | match_completed | high | true | 0.15 | true | live match ML: high void on unfinished match — prefer completed set/gam… | tennis · live · match_ml · action=match_completed · voidRisk=high · pre… |
| 2026-08-10T10:00:03.000Z | MARKET_ADDED | tennis | live | period_ml | period_completed_before_stop | medium | false | 0.05 | true | size residual action path only · patterns: fill.secondary-confirmation | tennis · live · period_ml · action=period_completed_before_stop · voidR… |

## Preset `patterns`

| time | eventType | voidRisk | maxSeverity | patternIds | patternCount | eyeOpeners |
| --- | --- | --- | --- | --- | ---: | --- |
| 2026-08-10T10:00:01.000Z | MARKET_ADDED | high | high | void.live-ml-unfinished, fill.secondary-confirmation, phase.pre… | 6 | [high] void.live-ml-unfinished: Live ML void risk=high (action: match_c… |
| 2026-08-10T10:00:02.000Z | PRICE_CHANGE | high | high | void.live-ml-unfinished, fill.secondary-confirmation, phase.pre… | 6 | [high] void.live-ml-unfinished: Live ML void risk=high (action: match_c… |
| 2026-08-10T10:00:04.000Z | PRICE_CHANGE | high | high | void.live-ml-unfinished, fill.secondary-confirmation, phase.pre… | 6 | [high] void.live-ml-unfinished: Live ML void risk=high (action: match_c… |
| 2026-08-10T10:00:05.000Z | PRICE_CHANGE | high | high | void.live-ml-unfinished, fill.secondary-confirmation, phase.pre… | 6 | [high] void.live-ml-unfinished: Live ML void risk=high (action: match_c… |
| 2026-08-10T10:00:05.000Z | PRICE_CHANGE | high | high | void.live-ml-unfinished, fill.secondary-confirmation, phase.pre… | 6 | [high] void.live-ml-unfinished: Live ML void risk=high (action: match_c… |
| 2026-08-10T10:00:03.000Z | MARKET_ADDED | medium | watch | fill.secondary-confirmation, phase.prematch-vs-live-product | 4 | [watch] fill.secondary-confirmation: In-play secondary confirmation + d… |

## Preset `ev`

| time | eventType | from | to | voidRisk | pVoidPrior | voidEv | twoWayEv | voidDelta |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| 2026-08-10T10:00:01.000Z | MARKET_ADDED | — | — | high | 0.15 | — | — | — |
| 2026-08-10T10:00:02.000Z | PRICE_CHANGE | 1.9 | 1.95 | high | 0.15 | 12.5 | -2.5 | -15 |
| 2026-08-10T10:00:04.000Z | PRICE_CHANGE | 1.5 | 1.55 | high | 0.15 | -7.5 | -22.5 | -15 |
| 2026-08-10T10:00:05.000Z | PRICE_CHANGE | 1.95 | 1.88 | high | 0.15 | 9 | -6 | -15 |
| 2026-08-10T10:00:05.000Z | PRICE_CHANGE | 1.55 | 1.62 | high | 0.15 | -4 | -19 | -15 |
| 2026-08-10T10:00:03.000Z | MARKET_ADDED | — | — | medium | 0.05 | — | — | — |

## Preset `all`

| time | timeMs | eventType | eventId | period | marketType | selection | detail | file | from | to | sportKey | phase | marketClass | actionThreshold | voidRisk | preferUnitMkts | pVoidPrior | pliveEqEzlive | sizingNote | summary | maxSeverity | patternIds | patternCount | eyeOpeners | voidEv | twoWayEv | voidDelta |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- | ---: | --- | ---: | ---: | ---: |
| 2026-08-10T10:00:01.000Z | 1786356001000 | MARKET_ADDED | 197510101 | m | 3 | — | market m/3 offered | live-tracker-event-197510101.jsonl | — | — | tennis | live | match_ml | match_completed | high | true | 0.15 | true | live match ML: high void on unfinished match — prefer completed set/gam… | tennis · live · match_ml · action=match_completed · voidRisk=high · pre… | high | void.live-ml-unfinished, fill.secondary-confirmation, phase.pre… | 6 | [high] void.live-ml-unfinished: Live ML void risk=high (action: match_c… | — | — | — |
| 2026-08-10T10:00:02.000Z | 1786356002000 | PRICE_CHANGE | 197510101 | m | 3 | 1 | price m/3/1 1.9→1.95 | live-tracker-event-197510101.jsonl | 1.9 | 1.95 | tennis | live | match_ml | match_completed | high | true | 0.15 | true | live match ML: high void on unfinished match — prefer completed set/gam… | tennis · live · match_ml · action=match_completed · voidRisk=high · pre… | high | void.live-ml-unfinished, fill.secondary-confirmation, phase.pre… | 6 | [high] void.live-ml-unfinished: Live ML void risk=high (action: match_c… | 12.5 | -2.5 | -15 |
| 2026-08-10T10:00:04.000Z | 1786356004000 | PRICE_CHANGE | 197510101 | m | 4 | 1 | price m/4/1 1.5→1.55 | live-tracker-event-197510101.jsonl | 1.5 | 1.55 | tennis | live | match_ml | match_completed | high | true | 0.15 | true | live match ML: high void on unfinished match — prefer completed set/gam… | tennis · live · match_ml · action=match_completed · voidRisk=high · pre… | high | void.live-ml-unfinished, fill.secondary-confirmation, phase.pre… | 6 | [high] void.live-ml-unfinished: Live ML void risk=high (action: match_c… | -7.5 | -22.5 | -15 |
| 2026-08-10T10:00:05.000Z | 1786356005000 | PRICE_CHANGE | 197510101 | m | 3 | 1 | price m/3/1 1.95→1.88 | live-tracker-event-197510101.jsonl | 1.95 | 1.88 | tennis | live | match_ml | match_completed | high | true | 0.15 | true | live match ML: high void on unfinished match — prefer completed set/gam… | tennis · live · match_ml · action=match_completed · voidRisk=high · pre… | high | void.live-ml-unfinished, fill.secondary-confirmation, phase.pre… | 6 | [high] void.live-ml-unfinished: Live ML void risk=high (action: match_c… | 9 | -6 | -15 |
| 2026-08-10T10:00:05.000Z | 1786356005000 | PRICE_CHANGE | 197510101 | m | 4 | 1 | price m/4/1 1.55→1.62 | live-tracker-event-197510101.jsonl | 1.55 | 1.62 | tennis | live | match_ml | match_completed | high | true | 0.15 | true | live match ML: high void on unfinished match — prefer completed set/gam… | tennis · live · match_ml · action=match_completed · voidRisk=high · pre… | high | void.live-ml-unfinished, fill.secondary-confirmation, phase.pre… | 6 | [high] void.live-ml-unfinished: Live ML void risk=high (action: match_c… | -4 | -19 | -15 |
| 2026-08-10T10:00:03.000Z | 1786356003000 | MARKET_ADDED | 197510101 | s1 | 3 | — | market s1/3 offered | live-tracker-event-197510101.jsonl | — | — | tennis | live | period_ml | period_completed_before_stop | medium | false | 0.05 | true | size residual action path only · patterns: fill.secondary-confirmation | tennis · live · period_ml · action=period_completed_before_stop · voidR… | watch | fill.secondary-confirmation, phase.prematch-vs-live-product | 4 | [watch] fill.secondary-confirmation: In-play secondary confirmation + d… | — | — | — |

