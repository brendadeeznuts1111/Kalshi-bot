// @see https://bun.com/docs/runtime/hashing#bun-hash
// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
import { simulateFillVwap } from "../../../src/institutions/shadow-sim.ts";
import {
  hashShadowLineBody,
  readShadowLogPrevHash,
  TOXICITY_DUE_OFFSET_MS,
  type ShadowPredictionLine,
  type ToxicityMark,
} from "../../../src/institutions/shadow-line.ts";
import { loadProgramManifest, type ProgramManifest } from "./program.ts";
import { feePerContractCents, FEE, rawEdgeCents } from "./fees.ts";
import type { SignalContext, Decision } from "./signal.ts";
import { midCents } from "./signal.ts";

export type { ShadowPredictionLine as ShadowLine, ToxicityMark };
export { buildToxicityMarkFields } from "../../../src/institutions/shadow-line.ts";
export { simulateFillVwap, toxicityMovedAgainst } from "../../../src/institutions/shadow-sim.ts";

export type ShadowAppendInput = {
  ctx: SignalContext;
  decision: Decision;
  priceCents: number;
  side: "yes" | "no";
};

function resolveLogPath(manifest: ProgramManifest, programRoot = "."): string {
  return `${programRoot}/${manifest.shadowLog}`.replace(/\/+/g, "/");
}

export async function appendShadowLine(
  input: ShadowAppendInput,
  options?: { manifestPath?: string; programRoot?: string },
): Promise<ShadowPredictionLine> {
  const manifest = await loadProgramManifest(options?.manifestPath ?? "program.json");
  const logPath = resolveLogPath(manifest, options?.programRoot ?? ".");
  const prevHash = await readShadowLogPrevHash(logPath);

  const contracts = input.decision.contracts ?? 0;
  const levels =
    input.decision.side === "no" ? input.ctx.book.bids : input.ctx.book.asks;
  const { vwapFillCents, filledContracts } =
    input.decision.action === "trade" && contracts > 0 && !input.ctx.book.crossed
      ? simulateFillVwap(levels, contracts)
      : { vwapFillCents: null, filledContracts: 0 };

  const midAtFill = midCents(input.ctx.book);
  const ts = Date.now();

  const body: Omit<ShadowPredictionLine, "lineHash"> = {
    kind: "prediction",
    prevHash,
    ts,
    program: manifest.name,
    ticker: input.ctx.ticker,
    eventId: input.ctx.eventId,
    pModel: input.ctx.pModel,
    components: input.ctx.components,
    book: input.ctx.book,
    decision: input.decision,
    rawEdgeCents: rawEdgeCents(input.ctx.pModel, input.priceCents),
    feePerContractCents:
      contracts > 0
        ? feePerContractCents(FEE.takerRate, contracts, input.priceCents)
        : 0,
    vwapFillCents,
    filledContracts,
    midAtFillCents: midAtFill,
    toxicity: {
      dueTs: ts + TOXICITY_DUE_OFFSET_MS,
      markedTs: null,
      midCents: null,
      movedAgainst: null,
    },
    outcome: null,
  };

  const line: ShadowPredictionLine = { ...body, lineHash: hashShadowLineBody(body) };
  await Bun.write(logPath, `${JSON.stringify(line)}\n`, { createPath: true, append: true });
  return line;
}
