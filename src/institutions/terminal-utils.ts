/**
 * Terminal utilities — Bun-native ANSI helpers and custom inspect formatters.
 *
 * Usage:
 *   import { dim, formatEdge, inspectDecision } from "./terminal-utils.ts";
 *   console.log(inspectDecision(decision, signalCtx));
 */
import type { Decision, SignalContext } from "./alpha-signal-types.ts";
import { ansiColor, type ColorKey } from "../lib/color/index.ts";
import { redactSecrets } from "../lib/redact.ts";
import { formatWithOptions } from "node:util";

// ── ANSI color helpers ──────────────────────────────────────────

function c(key: ColorKey): string {
  return ansiColor(key);
}

export const ANSI = {
  reset: "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  green:   c("tennis"),
  yellow:  c("middleware"),
  red:     c("trading"),
  blue:    c("polymarket"),
  magenta: c("env"),
  cyan:    c("kalshi"),
  brightGreen:  c("tennis"),
  brightRed:    c("trading"),
  brightYellow: c("middleware"),
  brightCyan:   c("kalshi"),
  brightBlue:   c("polymarket"),
} as const;

/**
 * Serialize any value with Bun.inspect (Bun's console.log formatting).
 * colors: true forces ANSI (crash-reporter style); false forces plain;
 * undefined lets Bun auto-detect (NO_COLOR / FORCE_COLOR / TTY).
 * depth limits recursion (truncates with [Object ...]). Bun.inspect's default
 * is FULL depth - it does NOT honor bunfig [console] depth (3 here), which only
 * applies to console.log. So the unset branch defaults depth to the same 3 to
 * match console.log's truncation; pass depth explicitly or verbose=true for full.
 */
export function inspectValue(
  value: unknown,
  opts: { colors?: boolean; depth?: number; verbose?: boolean; sorted?: boolean } = {},
): string {
  // Context-aware verbosity: verbose=true -> full depth + colors (DEBUG dumps);
  // verbose=false -> compact depth 2 plain; unset -> match console.log depth 3.
  if (opts.verbose === true)
    return Bun.inspect(value, {
      colors: true,
      ...(opts.sorted === undefined ? {} : { sorted: opts.sorted }),
    });
  if (opts.verbose === false)
    return Bun.inspect(value, {
      colors: false,
      depth: 2,
      ...(opts.sorted === undefined ? {} : { sorted: opts.sorted }),
    });
  return Bun.inspect(value, {
    ...(opts.colors === undefined ? {} : { colors: opts.colors }),
    depth: opts.depth ?? 3,
    ...(opts.sorted === undefined ? {} : { sorted: opts.sorted }),
  });
}

/** Colored serialization for terminal diagnostics. */
export function inspectColor(value: unknown): string {
  return inspectValue(value, { colors: true });
}

/**

/** printf-style line formatting (%s, %d, %o) via util.formatWithOptions. */
export function formatLine(format: string, ...args: unknown[]): string {
  return formatWithOptions({ colors: false }, format, ...args);
}

/** Colored printf-style line formatting. */
export function formatLineColor(format: string, ...args: unknown[]): string {
  return formatWithOptions({ colors: true }, format, ...args);
}

/**
 * Serialize with secrets redacted first (never leaks tokens/PII to logs).
 * Same output shape as inspectValue over the redacted clone.
 */
export function inspectRedacted(
  value: unknown,
  opts: { colors?: boolean; depth?: number } = {},
): string {
  return Bun.inspect(redactSecrets(value), {
    ...(opts.colors === undefined ? {} : { colors: opts.colors }),
    ...(opts.depth === undefined ? {} : { depth: opts.depth }),
  });
}


/** Color a value by edge threshold. */
export function edgeColor(edgeCents: number): string {
  if (edgeCents > 4) return ANSI.green;
  if (edgeCents > 2) return ANSI.yellow;
  if (edgeCents < 0) return ANSI.red;
  return ANSI.dim;
}

/** Format an edge value with color. */
export function formatEdge(edgeCents: number): string {
  const sign = edgeCents >= 0 ? "+" : "";
  const color = edgeColor(edgeCents);
  return `${color}${sign}${edgeCents.toFixed(1)}¢${ANSI.reset}`;
}

/** Color a probability (0–1) by confidence bands. */
export function probColor(p: number): string {
  if (p > 0.75 || p < 0.25) return ANSI.green;   // high conviction
  if (p > 0.65 || p < 0.35) return ANSI.yellow;  // moderate
  return ANSI.dim;                                 // near coin-flip
}

/** Format a probability with color. */
export function formatProb(p: number): string {
  return `${probColor(p)}${(p * 100).toFixed(0)}%${ANSI.reset}`;
}

// ── Custom inspect formatters ───────────────────────────────────

/**
 * One-line summary of a Decision for console.log.
 *
 * Example output:
 *   TRADE  +3.2¢  yes × 25  @ 55¢  | edge > threshold
 *   SKIP   crossed book — transient anomaly
 */
export function inspectDecision(d: Decision, ctx?: SignalContext): string {
  const actionTag =
    d.action === "trade"
      ? `${ANSI.green}${ANSI.bold}TRADE${ANSI.reset}`
      : `${ANSI.dim}SKIP${ANSI.reset}`;

  if (d.action === "skip") {
    return `${actionTag}  ${ANSI.dim}${d.reason}${ANSI.reset}`;
  }

  const edge = ctx ? ctx.pModel * 100 - ((ctx.book.asks[0]?.priceCents ?? 50) / 100) * 100 : 0;
  const edgeStr = formatEdge(edge);
  const sideStr = d.side === "yes" ? `${ANSI.green}yes${ANSI.reset}` : `${ANSI.red}no${ANSI.reset}`;
  const contractsStr = d.contracts != null ? `× ${d.contracts}` : "";
  const limitStr = d.limitCents != null ? `@ ${d.limitCents}¢` : "";
  const reasonStr = d.reason ? `${ANSI.dim}| ${d.reason}${ANSI.reset}` : "";

  return `${actionTag}  ${edgeStr}  ${sideStr} ${contractsStr} ${limitStr} ${reasonStr}`.trim();
}

/**
 * One-line summary of a SignalContext for console.log.
 *
 * Example output:
 *   KXNBAGAME-26JUL24LALBOS  LAL vs BOS  52%  +1.5¢  mid=52¢  spread=3¢
 */
export function inspectSignalContext(ctx: SignalContext): string {
  const tickerStr = `${ANSI.bold}${ctx.ticker.slice(-20)}${ANSI.reset}`;
  const pStr = formatProb(ctx.pModel);

  const bestBid = ctx.book.bids[0]?.priceCents;
  const bestAsk = ctx.book.asks[0]?.priceCents;
  const mid = bestBid != null && bestAsk != null ? Math.round((bestBid + bestAsk) / 2) : null;
  const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;

  const edge = mid != null ? ctx.pModel * 100 - mid : 0;
  const edgeStr = formatEdge(edge);

  const parts = [
    tickerStr,
    pStr,
    edgeStr,
    mid != null ? `mid=${mid}¢` : "",
    spread != null ? `spread=${spread}¢` : "",
    ctx.book.crossed ? `${ANSI.red}CROSSED${ANSI.reset}` : "",
    ctx.contracts != null ? `×${ctx.contracts}` : "",
  ].filter(Boolean);

  return parts.join("  ");
}

/** Render a row of Decision + SignalContext pairs as a terminal table. */
export function inspectDecisionsTable(
  decisions: Array<{ decision: Decision; ctx: SignalContext }>,
): string {
  const rows = decisions.map(({ decision, ctx }, i) => ({
    "#": String(i + 1),
    Event: ctx.ticker.slice(-24),
    P: (ctx.pModel * 100).toFixed(0) + "%",
    Action: decision.action === "trade" ? "TRADE" : "SKIP",
    Side: decision.side ?? "",
    Edge: (ctx.pModel * 100 - ((ctx.book.asks[0]?.priceCents ?? 50))).toFixed(1) + "¢",
    Reason: decision.reason.slice(0, 40),
  }));
  return Bun.inspect.table(rows, ["#", "Event", "P", "Action", "Side", "Edge", "Reason"], { colors: true });
}