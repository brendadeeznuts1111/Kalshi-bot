/**
 * hq-ui.ts — versioned HQ component library (server-side render helpers).
 *
 * Every component returns an HTML string using only design-token CSS vars.
 * Components are individually versioned; bump a component's `version` when its
 * markup contract changes, and add — never rename — entries in HQ_COMPONENTS.
 *
 * Import pattern for views:
 *   import { HQ_COMPONENTS, badge, statCard } from "../institutions/hq-ui.ts";
 */
import { DESIGN_SYSTEM_VERSION, TOKENS } from "./design-tokens.ts";

export { DESIGN_SYSTEM_VERSION };

// ── Component registry (name → version) ──

export const HQ_COMPONENTS = {
  badge: "1.0.0",
  statCard: "1.0.0",
  panel: "1.0.0",
  dataTable: "1.0.0",
  hint: "1.0.0",
  tag: "1.0.0",
} as const;

export type HqComponent = keyof typeof HQ_COMPONENTS;

const esc = (v: unknown): string => Bun.escapeHTML(String(v ?? "")); // native (§43)

// ── badge@1.0.0 — semantic status pill ──

export type BadgeTone = "ok" | "warn" | "bad" | "dim";

export function badge(tone: BadgeTone, text: string): string {
  return `<span class="badge ${tone}">${esc(text)}</span>`;
}

// ── tag@1.0.0 — neutral keyword chip ──

export function tag(text: string): string {
  return `<span class="tag">${esc(text)}</span>`;
}

// ── hint@1.0.0 — tooltip dot fed by glossary TOOLTIPS ──

export function hint(tooltip: string): string {
  return ` <span class="hint" title="${esc(tooltip)}">?</span>`;
}

// ── statCard@1.1.0 — headline metric card with secondary metric grid ──

export function statCard(opts: {
  title: string;
  value: string;
  unit?: string;
  /** Secondary metric rows: each entry renders as label + value pair below the main value. */
  metrics?: Array<{ label: string; value: string }>;
}): string {
  const unitHtml = opts.unit
    ? `<span class="unit">${esc(opts.unit)}</span>`
    : "";
  const metricsHtml = opts.metrics?.length
    ? `<div class="card-metrics">${opts.metrics.map(
        (m) => `<div class="card-metric"><span class="card-metric-label">${esc(m.label)}</span><span class="card-metric-value">${esc(m.value)}</span></div>`,
      ).join("")}</div>`
    : "";
  return `<div class="card"><h3>${esc(opts.title)}</h3>` +
    `<div class="big">${esc(opts.value)}${unitHtml}</div>` +
    metricsHtml +
    `</div>`;
}

// ── panel@1.0.0 — titled section container ──

export function panel(title: string, innerHtml: string, titleSuffix = ""): string {
  return `<div class="panel"><h2>${esc(title)}${titleSuffix}</h2>${innerHtml}</div>`;
}

// ── dataTable@1.0.0 — canonical table (num columns right-aligned mono) ──

export type TableColumn = { label: string; num?: boolean; tooltip?: string };
export type TableRow = Array<string | number | null>;

export function dataTable(columns: TableColumn[], rows: TableRow[], empty = "none"): string {
  if (!rows.length) return `<div class="muted">${esc(empty)}</div>`;
  const head = columns
    .map(
      (c) =>
        `<th${c.num ? ' class="num"' : ""}>${esc(c.label)}${c.tooltip ? hint(c.tooltip) : ""}</th>`,
    )
    .join("");
  const body = rows
    .map(
      (r) =>
        "<tr>" +
        r
          .map((cell, i) => {
            const cls = columns[i]?.num ? ' class="num"' : "";
            return `<td${cls}>${typeof cell === "string" && cell.startsWith("<") ? cell : esc(cell)}</td>`;
          })
          .join("") +
        "</tr>",
    )
    .join("");
  return `<table><tr>${head}</tr>${body}</table>`;
}

// ── Component base styles (token-driven; views embed once) ──

export function componentCss(): string {
  const t = TOKENS;
  return `
.badge { display: inline-block; padding: 0.1rem 0.55rem; border-radius: ${t.radius.pill};
  font-size: ${t.font.sizeMicro}; font-weight: 600; }
.badge.ok { background: ${t.color.okTint}; color: ${t.color.ok}; }
.badge.warn { background: ${t.color.warnTint}; color: ${t.color.warn}; }
.badge.bad { background: ${t.color.badTint}; color: ${t.color.bad}; }
.badge.dim { background: ${t.color.panel2}; color: ${t.color.dim}; }
.tag { display: inline-block; background: ${t.color.panel2}; border: 1px solid ${t.color.line};
  border-radius: ${t.radius.sm}; padding: 0 0.4rem; font-size: ${t.font.sizeMicro};
  color: ${t.color.dim}; margin: 0.1rem; }
.hint { display: inline-block; width: 0.95rem; height: 0.95rem; line-height: 0.95rem;
  text-align: center; border-radius: 50%; background: ${t.color.panel2};
  border: 1px solid ${t.color.line}; color: ${t.color.dim}; font-size: 0.65rem;
  cursor: help; vertical-align: middle; }
.card { background: ${t.color.panel}; border: 1px solid ${t.color.line};
  border-radius: ${t.radius.lg}; padding: ${t.space.md} 1rem; }
.card h3 { margin: 0 0 ${t.space.sm}; font-size: ${t.font.sizeMicro}; text-transform: uppercase;
  letter-spacing: 0.08em; color: ${t.color.dim}; font-weight: 600; }
.big { font-size: ${t.font.sizeStat}; font-weight: 700; font-family: ${t.font.mono}; }
.unit { color: ${t.color.dim}; font-size: 0.85rem; margin-left: 0.25rem; font-weight: 400; }
.card-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 0.25rem 0.75rem; margin-top: 0.5rem;
  padding-top: 0.5rem; border-top: 1px solid ${t.color.line}; }
.card-metric { display: flex; flex-direction: column; }
.card-metric-label { font-size: ${t.font.sizeMicro}; color: ${t.color.dim}; text-transform: uppercase;
  letter-spacing: 0.05em; }
.card-metric-value { font-family: ${t.font.mono}; font-size: 0.85rem; }
.panel { background: ${t.color.panel}; border: 1px solid ${t.color.line};
  border-radius: ${t.radius.lg}; padding: 1rem; margin-bottom: ${t.space.md}; }
.panel h2 { margin: 0 0 0.75rem; font-size: 0.95rem; }
table { width: 100%; border-collapse: collapse; font-size: ${t.font.sizeSmall}; }
th, td { padding: 0.45rem 0.6rem; text-align: left; border-bottom: 1px solid ${t.color.line}; }
th { color: ${t.color.dim}; font-weight: 600; font-size: ${t.font.sizeMicro};
  text-transform: uppercase; letter-spacing: 0.06em; }
td.num, th.num { text-align: right; font-family: ${t.font.mono}; }
.muted { color: ${t.color.dim}; }
.grid { display: grid; gap: ${t.space.md}; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.cols { display: grid; gap: ${t.space.md}; grid-template-columns: 1fr 1fr; }
@media (max-width: 900px) { .cols { grid-template-columns: 1fr; } }
`;
}
