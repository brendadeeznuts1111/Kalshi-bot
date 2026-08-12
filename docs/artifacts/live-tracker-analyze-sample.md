# Live-tracker analyze sample (tennis / live)

Generated `2026-08-12T01:12:26.048Z` · sport=`tennis` phase=`live` · schema v2

## Desk preset

| time | timeMs | eventType | period | marketType | from | to | voidRisk | maxSeverity | patternIds | pVoidPrior | sizingNote |
| --- | ---: | --- | --- | --- | ---: | ---: | --- | --- | --- | ---: | --- |
| 2026-08-10T10:00:02.000Z | 1786356002000 | PRICE_CHANGE | m | 3 | 1.9 | 1.95 | high | high | void.live-ml-unfinished, fill.secondary-confirmation, phase.pre… | 0.15 | live match ML: high void on unfinished match — prefer completed set/gam… |

## EV preset

| time | eventType | from | to | voidRisk | pVoidPrior | voidEv | twoWayEv | voidDelta |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| 2026-08-10T10:00:02.000Z | PRICE_CHANGE | 1.9 | 1.95 | high | 0.15 | 22.250000000000014 | 7.250000000000014 | -15 |
