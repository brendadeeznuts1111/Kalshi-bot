# tennis-hq

Tennis HQ terminal + web chart helpers (aligned bars).

| Path | Role |
|------|------|
| `charts/ascii-bars.ts` | CLI horizontal bars (`renderBarChart`, `renderMidDistribution`) |
| `utils/terminal.ts` | `c` ANSI + `pad` via `Bun.stringWidth` |

Web bars: `src/research/hq-app/styles.css` (`.bar-chart-*`) + `barChartHtml` in `app.js`.

```bash
bun test tests/lib/tennis-hq-ascii-bars.test.ts
bun -e 'import { renderBarChart, chartRowsAligned } from "./src/lib/tennis-hq/charts/ascii-bars.ts";
const o = renderBarChart([
  { label: "ATP", value: 3.2e6, raw: "3.2M" },
  { label: "ITF W", value: 9.5e5, raw: "950K" },
], { labelWidth: 8, barWidth: 28 });
console.log(o, "aligned=", chartRowsAligned(o));'
```
