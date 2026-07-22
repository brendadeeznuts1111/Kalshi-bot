import { appendFile } from "node:fs/promises";
import type { BookSnapshot, Decision } from "./alpha-signal-types.ts";
import { toxicityMovedAgainst } from "./shadow-sim.ts";

export type ToxicityMark = {
  dueTs: number;
  markedTs: number | null;
  midCents: number | null;
  movedAgainst: boolean | null;
};

/** Immutable prediction line — toxicity/outcome fields stay null; marks arrive as append-only entries. */
export interface ShadowPredictionLine {
  kind?: "prediction";
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
  outcome?: number | null;
  lineHash: string;
}

/** Append-only toxicity mark referencing a prediction lineHash. */
export type ToxicityMarkEntry = {
  kind: "toxicity-mark";
  prevHash: string;
  lineHash: string;
  ts: number;
  program: string;
  refLineHash: string;
  markedTs: number;
  midCents: number;
  movedAgainst: boolean;
};

/** Append-only outcome for all predictions sharing an eventId. */
export type OutcomeResolutionEntry = {
  kind: "outcome-resolution";
  prevHash: string;
  lineHash: string;
  ts: number;
  program: string;
  eventId: string;
  outcome: 0 | 1;
};

export type ShadowLogEntry = ShadowPredictionLine | ToxicityMarkEntry | OutcomeResolutionEntry;

/** @deprecated Alias — use ShadowPredictionLine. Materialized view after join. */
export type ShadowLine = ShadowPredictionLine;

/** Offset from fill ts to toxicity due time (mid at T+60s). */
export const TOXICITY_DUE_OFFSET_MS = 60_000;

/** Valid mark window after dueTs — marks outside this window are wrong, not late. */
export const TOXICITY_MARK_WINDOW_MS = 15_000;

export function isPredictionEntry(entry: ShadowLogEntry): entry is ShadowPredictionLine {
  return entry.kind === "prediction" || entry.kind === undefined;
}

export function isToxicityMarkEntry(entry: ShadowLogEntry): entry is ToxicityMarkEntry {
  return entry.kind === "toxicity-mark";
}

export function isOutcomeResolutionEntry(entry: ShadowLogEntry): entry is OutcomeResolutionEntry {
  return entry.kind === "outcome-resolution";
}

export function parseShadowLogEntry(raw: unknown): ShadowLogEntry {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("shadow log entry must be an object");
  }
  const kind = (raw as { kind?: string }).kind;
  if (kind === "toxicity-mark") return raw as ToxicityMarkEntry;
  if (kind === "outcome-resolution") return raw as OutcomeResolutionEntry;
  return raw as ShadowPredictionLine;
}

export async function readShadowLogEntries(absPath: string): Promise<ShadowLogEntry[]> {
  const file = Bun.file(absPath);
  if (!(await file.exists())) return [];
  const entries: ShadowLogEntry[] = [];
  for (const line of (await file.text()).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    entries.push(parseShadowLogEntry(JSON.parse(trimmed)));
  }
  return entries;
}

/** Join append-only marks and resolutions onto immutable prediction lines. */
export function materializeShadowLines(entries: ShadowLogEntry[]): ShadowPredictionLine[] {
  const predictions: ShadowPredictionLine[] = [];
  const toxicityByRef = new Map<string, ToxicityMarkEntry>();
  const outcomeByEvent = new Map<string, 0 | 1>();

  for (const entry of entries) {
    if (isPredictionEntry(entry)) {
      predictions.push({ ...entry, kind: "prediction" });
    } else if (isToxicityMarkEntry(entry)) {
      toxicityByRef.set(entry.refLineHash, entry);
    } else if (isOutcomeResolutionEntry(entry)) {
      outcomeByEvent.set(entry.eventId, entry.outcome);
    }
  }

  return predictions.map((line) => {
    const tox = toxicityByRef.get(line.lineHash);
    const resolvedOutcome = outcomeByEvent.get(line.eventId);
    const legacyInlineTox = line.toxicity.markedTs != null ? line.toxicity : null;
    const legacyInlineOutcome =
      line.outcome === 0 || line.outcome === 1 ? line.outcome : undefined;

    return {
      ...line,
      toxicity: tox
        ? {
            dueTs: line.toxicity.dueTs,
            markedTs: tox.markedTs,
            midCents: tox.midCents,
            movedAgainst: tox.movedAgainst,
          }
        : legacyInlineTox ?? line.toxicity,
      outcome: resolvedOutcome ?? legacyInlineOutcome ?? line.outcome ?? null,
    };
  });
}

/** Materialized predictions for metrics — chain integrity checked on raw entries separately. */
export async function readShadowLog(absPath: string): Promise<ShadowPredictionLine[]> {
  return materializeShadowLines(await readShadowLogEntries(absPath));
}

export function verifyHashChainEntries(entries: ShadowLogEntry[]): boolean {
  let expectedPrev = "0";
  for (const entry of entries) {
    if (entry.prevHash !== expectedPrev) return false;
    const { lineHash: _h, ...body } = entry;
    const computed = hashShadowLineBody(body as Omit<ShadowLogEntry, "lineHash">);
    if (computed !== entry.lineHash) return false;
    expectedPrev = entry.lineHash;
  }
  return true;
}

/** @deprecated Use verifyHashChainEntries on raw log entries. */
export function verifyHashChain(lines: ShadowPredictionLine[]): boolean {
  return verifyHashChainEntries(lines);
}

export function brierScore(lines: ShadowPredictionLine[]): number | null {
  const resolved = lines.filter(
    (l) => l.outcome === 0 || l.outcome === 1,
  ) as Array<ShadowPredictionLine & { outcome: 0 | 1 }>;
  if (!resolved.length) return null;
  const sum = resolved.reduce((acc, l) => acc + (l.pModel - l.outcome) ** 2, 0);
  return sum / resolved.length;
}

export function baselineProbability(line: ShadowPredictionLine): number | null {
  const side = line.decision.side ?? "yes";
  if (side === "yes") {
    return line.components.pinnacle_novig_home ?? null;
  }
  return line.components.pinnacle_novig_away ?? null;
}

export function baselineBrierScore(lines: ShadowPredictionLine[]): number | null {
  const resolved = lines.filter(
    (l) => (l.outcome === 0 || l.outcome === 1) && baselineProbability(l) != null,
  ) as Array<ShadowPredictionLine & { outcome: 0 | 1 }>;
  if (!resolved.length) return null;
  const sum = resolved.reduce((acc, l) => {
    const p = baselineProbability(l)!;
    return acc + (p - l.outcome) ** 2;
  }, 0);
  return sum / resolved.length;
}

export function brierStdErr(resolvedCount: number): number | null {
  if (resolvedCount <= 0) return null;
  return 0.2 / Math.sqrt(resolvedCount);
}

export function realizedEdgeCentsPerFill(line: ShadowPredictionLine): number | null {
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

export function realizedEdgeMetrics(lines: ShadowPredictionLine[]): {
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

export function hashShadowLineBody(body: Omit<ShadowLogEntry, "lineHash">): string {
  return String(Bun.hash(JSON.stringify(body)));
}

export async function readShadowLogPrevHash(absPath: string): Promise<string> {
  const entries = await readShadowLogEntries(absPath);
  if (!entries.length) return "0";
  return entries[entries.length - 1]!.lineHash;
}

type ShadowLogBody =
  | Omit<ShadowPredictionLine, "lineHash" | "prevHash">
  | Omit<ToxicityMarkEntry, "lineHash" | "prevHash">
  | Omit<OutcomeResolutionEntry, "lineHash" | "prevHash">;

export async function appendShadowLogEntry(
  absPath: string,
  body: ShadowLogBody,
): Promise<ShadowLogEntry> {
  const prevHash = await readShadowLogPrevHash(absPath);
  const fullBody = { ...body, prevHash } as Omit<ShadowLogEntry, "lineHash">;
  const lineHash = hashShadowLineBody(fullBody);
  const entry = { ...fullBody, lineHash } as ShadowLogEntry;
  await appendFile(absPath, `${JSON.stringify(entry)}\n`);
  return entry;
}

/** Initial hash chain for a single prediction line (tests / seed). */
export function sealPredictionLine(line: ShadowPredictionLine): ShadowPredictionLine {
  const { lineHash: _h, prevHash, ...rest } = line;
  const body = { ...rest, prevHash, kind: "prediction" as const };
  return { ...body, lineHash: hashShadowLineBody(body) };
}

export function buildToxicityMarkFields(
  line: ShadowPredictionLine,
  midAfter60sCents: number,
): { midCents: number; movedAgainst: boolean } {
  const movedAgainst =
    line.midAtFillCents == null
      ? false
      : toxicityMovedAgainst(
          line.decision.side ?? "yes",
          line.midAtFillCents,
          midAfter60sCents,
        );
  return { midCents: midAfter60sCents, movedAgainst };
}

export function isInToxicityMarkWindow(line: ShadowPredictionLine, now: number): boolean {
  return (
    now >= line.toxicity.dueTs && now <= line.toxicity.dueTs + TOXICITY_MARK_WINDOW_MS
  );
}

export function isToxicityMarkMissed(line: ShadowPredictionLine, now: number): boolean {
  return now > line.toxicity.dueTs + TOXICITY_MARK_WINDOW_MS;
}

export function existingToxicityMarkRefs(entries: ShadowLogEntry[]): Set<string> {
  return new Set(
    entries.filter(isToxicityMarkEntry).map((entry) => entry.refLineHash),
  );
}

export function existingOutcomeEventIds(entries: ShadowLogEntry[]): Set<string> {
  return new Set(
    entries.filter(isOutcomeResolutionEntry).map((entry) => entry.eventId),
  );
}

export function selectDueToxicityMarks(
  entries: ShadowLogEntry[],
  now = Date.now(),
  options?: { forceDue?: boolean; allowStaleMark?: boolean },
): {
  toMark: ShadowPredictionLine[];
  pending: number;
  missed: number;
} {
  const markedRefs = existingToxicityMarkRefs(entries);
  const materialized = materializeShadowLines(entries);
  let pending = 0;
  let missed = 0;
  const toMark: ShadowPredictionLine[] = [];

  for (const line of materialized) {
    if (line.decision.action !== "trade") continue;
    if (markedRefs.has(line.lineHash)) continue;
    if (line.toxicity.markedTs != null) continue;

    if (options?.forceDue && options.allowStaleMark) {
      toMark.push(line);
      continue;
    }

    if (now < line.toxicity.dueTs) {
      pending++;
      continue;
    }
    if (isToxicityMarkMissed(line, now)) {
      missed++;
      continue;
    }
    if (isInToxicityMarkWindow(line, now)) {
      toMark.push(line);
    } else {
      pending++;
    }
  }

  return { toMark, pending, missed };
}

export async function appendToxicityMarks(
  absPath: string,
  program: string,
  marks: Array<{ line: ShadowPredictionLine; midCents: number; markedTs?: number }>,
): Promise<number> {
  let appended = 0;
  for (const { line, midCents, markedTs = Date.now() } of marks) {
    const fields = buildToxicityMarkFields(line, midCents);
    await appendShadowLogEntry(absPath, {
      kind: "toxicity-mark",
      ts: markedTs,
      program,
      refLineHash: line.lineHash,
      markedTs,
      midCents: fields.midCents,
      movedAgainst: fields.movedAgainst,
    });
    appended++;
  }
  return appended;
}

export async function appendOutcomeResolutions(
  absPath: string,
  program: string,
  outcomesByEventId: Record<string, 0 | 1>,
  existingEntries?: ShadowLogEntry[],
): Promise<number> {
  const entries = existingEntries ?? (await readShadowLogEntries(absPath));
  const resolvedEvents = existingOutcomeEventIds(entries);
  let appended = 0;

  for (const [eventId, outcome] of Object.entries(outcomesByEventId)) {
    if (outcome !== 0 && outcome !== 1) continue;
    if (resolvedEvents.has(eventId)) continue;
    await appendShadowLogEntry(absPath, {
      kind: "outcome-resolution",
      ts: Date.now(),
      program,
      eventId,
      outcome,
    });
    resolvedEvents.add(eventId);
    appended++;
  }

  return appended;
}
