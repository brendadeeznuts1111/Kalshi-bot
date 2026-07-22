import type { BookSnapshot, Decision } from "./alpha-signal-types.ts";
import { toxicityMovedAgainst } from "./shadow-sim.ts";

export type ToxicityMark = {
  dueTs: number;
  markedTs: number | null;
  midCents: number | null;
  movedAgainst: boolean | null;
};

/** One hash-chained shadow log line — optional `outcome` filled when event resolves. */
export interface ShadowLine {
  prevHash: string;
  ts: number;
  program: string;
  ticker: string;
  eventId: string;
  pModel: number;
  components: Record<string, number>;
  book: BookSnapshot;
  decision: Decision;
  rawEdgeCents: number;
  feePerContractCents: number;
  vwapFillCents: number | null;
  filledContracts: number;
  midAtFillCents: number | null;
  toxicity: ToxicityMark;
  /** 0 or 1 when resolved — enables Brier in calibration watcher. */
  outcome?: number | null;
  lineHash: string;
}

export async function readShadowLog(absPath: string): Promise<ShadowLine[]> {
  const file = Bun.file(absPath);
  if (!(await file.exists())) return [];
  const lines: ShadowLine[] = [];
  for (const line of (await file.text()).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    lines.push(JSON.parse(trimmed) as ShadowLine);
  }
  return lines;
}

export function verifyHashChain(lines: ShadowLine[]): boolean {
  let expectedPrev = "0";
  for (const line of lines) {
    if (line.prevHash !== expectedPrev) return false;
    const { lineHash: _h, ...body } = line;
    const computed = String(Bun.hash(JSON.stringify(body)));
    if (computed !== line.lineHash) return false;
    expectedPrev = line.lineHash;
  }
  return true;
}

export function brierScore(lines: ShadowLine[]): number | null {
  const resolved = lines.filter(
    (l) => l.outcome === 0 || l.outcome === 1,
  ) as Array<ShadowLine & { outcome: 0 | 1 }>;
  if (!resolved.length) return null;
  const sum = resolved.reduce((acc, l) => acc + (l.pModel - l.outcome) ** 2, 0);
  return sum / resolved.length;
}

/** Pinnacle-only prediction from components — empirical baseline for watcher. */
export function baselineProbability(line: ShadowLine): number | null {
  const side = line.decision.side ?? "yes";
  if (side === "yes") {
    return line.components.pinnacle_novig_home ?? null;
  }
  return line.components.pinnacle_novig_away ?? null;
}

/** Brier if we had traded pinnacle novig alone (no incremental model). */
export function baselineBrierScore(lines: ShadowLine[]): number | null {
  const resolved = lines.filter(
    (l) => (l.outcome === 0 || l.outcome === 1) && baselineProbability(l) != null,
  ) as Array<ShadowLine & { outcome: 0 | 1 }>;
  if (!resolved.length) return null;
  const sum = resolved.reduce((acc, l) => {
    const p = baselineProbability(l)!;
    return acc + (p - l.outcome) ** 2;
  }, 0);
  return sum / resolved.length;
}

/**
 * Approximate SE on mean Brier at n resolved outcomes.
 * A coin-flip predicted at 0.5 yields Brier exactly 0.25 — that is not a variance floor.
 * Detecting 0.01–0.02 gaps between similar sharp models at n≈100 needs much more data.
 */
export function brierStdErr(resolvedCount: number): number | null {
  if (resolvedCount <= 0) return null;
  return 0.2 / Math.sqrt(resolvedCount);
}

/** Expected edge after fees at fill — cents per contract (pre-outcome, direct money measure). */
export function realizedEdgeCentsPerFill(line: ShadowLine): number | null {
  if (line.decision.action !== "trade") return null;
  if (line.filledContracts <= 0 || line.vwapFillCents == null) return null;
  const fee = line.feePerContractCents;
  const side = line.decision.side ?? "yes";
  if (side === "yes") {
    return line.pModel * 100 - line.vwapFillCents - fee;
  }
  const noPriceCents = 100 - line.vwapFillCents;
  return (1 - line.pModel) * 100 - noPriceCents - fee;
}

export function realizedEdgeMetrics(lines: ShadowLine[]): {
  fillCount: number;
  meanRealizedEdgeCentsPerFill: number | null;
} {
  const edges: number[] = [];
  for (const line of lines) {
    const edge = realizedEdgeCentsPerFill(line);
    if (edge != null) edges.push(edge);
  }
  if (!edges.length) {
    return { fillCount: 0, meanRealizedEdgeCentsPerFill: null };
  }
  const sum = edges.reduce((acc, v) => acc + v, 0);
  return { fillCount: edges.length, meanRealizedEdgeCentsPerFill: sum / edges.length };
}

/** Bun.hash commitment for one log line body (excludes lineHash). */
export function hashShadowLineBody(body: Omit<ShadowLine, "lineHash">): string {
  return String(Bun.hash(JSON.stringify(body)));
}

/** Re-chain prevHash/lineHash after in-place edits (toxicity, outcomes). */
export function recomputeHashChain(lines: ShadowLine[]): ShadowLine[] {
  let prevHash = "0";
  const out: ShadowLine[] = [];
  for (const line of lines) {
    const { lineHash: _h, prevHash: _p, ...rest } = line;
    const body: Omit<ShadowLine, "lineHash"> = { ...rest, prevHash };
    const lineHash = hashShadowLineBody(body);
    out.push({ ...body, lineHash });
    prevHash = lineHash;
  }
  return out;
}

export async function writeShadowLog(absPath: string, lines: ShadowLine[]): Promise<void> {
  const chained = recomputeHashChain(lines);
  const text = chained.map((l) => JSON.stringify(l)).join("\n") + (chained.length ? "\n" : "");
  await Bun.write(absPath, text, { createPath: true });
}

export function applyToxicityMark(
  line: ShadowLine,
  midAfter60sCents: number,
  markedTs = Date.now(),
): ShadowLine {
  const movedAgainst =
    line.midAtFillCents == null
      ? null
      : toxicityMovedAgainst(
          line.decision.side ?? "yes",
          line.midAtFillCents,
          midAfter60sCents,
        );
  return {
    ...line,
    toxicity: {
      ...line.toxicity,
      markedTs,
      midCents: midAfter60sCents,
      movedAgainst,
    },
  };
}

export function applyOutcomes(
  lines: ShadowLine[],
  outcomesByEventId: Record<string, 0 | 1>,
): { lines: ShadowLine[]; updated: number } {
  let updated = 0;
  const next = lines.map((line) => {
    if (line.outcome === 0 || line.outcome === 1) return line;
    const outcome = outcomesByEventId[line.eventId];
    if (outcome !== 0 && outcome !== 1) return line;
    updated++;
    return { ...line, outcome };
  });
  return { lines: next, updated };
}

export function markDueToxicity(
  lines: ShadowLine[],
  midByTicker: Record<string, number>,
  now = Date.now(),
  options?: { forceDue?: boolean },
): { lines: ShadowLine[]; marked: number; pending: number } {
  let marked = 0;
  let pending = 0;
  const next = lines.map((line) => {
    if (line.decision.action !== "trade") return line;
    if (line.toxicity.markedTs != null) return line;
    if (line.toxicity.dueTs > now && !options?.forceDue) {
      pending++;
      return line;
    }
    const mid = midByTicker[line.ticker];
    if (mid == null) {
      pending++;
      return line;
    }
    marked++;
    return applyToxicityMark(line, mid, now);
  });
  return { lines: next, marked, pending };
}
