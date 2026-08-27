`NO_COLOR` / `FORCE_COLOR` / `TERM` set color depth at bootstrap; runtime mutation is invisible (probed). Probed matrix: `FORCE_COLOR` overrides `NO_COLOR` and caps depth (`=1` downgrades the chip gradient to 16-color; `COLORTERM=truecolor` does not rescue). `check.yml` pins `NO_COLOR=1` for deterministic tests.

`ODDS_LIVE_FEED=1` opens the live ladder; everything else stays simulated by default.
