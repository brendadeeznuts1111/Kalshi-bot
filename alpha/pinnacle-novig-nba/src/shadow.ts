// @see https://bun.com/docs/runtime/hashing#bun-hash
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { simulateFillVwap } from "../../../src/institutions/shadow-sim.ts";
import {
  applyToxicityMark,
  hashShadowLineBody,
  type ShadowLine,
  type ToxicityMark,
} from "../../../src/institutions/shadow-line.ts";
import { loadProgramManifest, type ProgramManifest } from "./program.ts";
import { feePerContractCents, FEE, rawEdgeCents } from "./fees.ts";
import type { SignalContext, Decision } from "./signal.ts";
import { midCents } from "./signal.ts";

export type { ShadowLine, ToxicityMark };
export { applyToxicityMark } from "../../../src/institutions/shadow-line.ts";
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

async function readPrevHash(logPath: string): Promise<string> {
  const file = Bun.file(logPath);
  if (!(await file.exists())) return "0";
  const text = (await file.text()).trim();
  if (!text) return "0";
  const lines = text.split("\n");
  const last = JSON.parse(lines[lines.length - 1]!) as ShadowLine;
  return last.lineHash;
}

export async function appendShadowLine(
  input: ShadowAppendInput,
  options?: { manifestPath?: string; programRoot?: string },
): Promise<ShadowLine> {
  const manifest = await loadProgramManifest(options?.manifestPath ?? "program.json");
  const logPath = resolveLogPath(manifest, options?.programRoot ?? ".");
  const prevHash = await readPrevHash(logPath);

  const contracts = input.decision.contracts ?? 0;
  const levels =
    input.decision.side === "no" ? input.ctx.book.bids : input.ctx.book.asks;
  const { vwapFillCents, filledContracts } =
    input.decision.action === "trade" && contracts > 0
      ? simulateFillVwap(levels, contracts)
      : { vwapFillCents: null, filledContracts: 0 };

  const midAtFill = midCents(input.ctx.book);
  const ts = Date.now();

  const body: Omit<ShadowLine, "lineHash"> = {
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
      dueTs: ts + 60_000,
      markedTs: null,
      midCents: null,
      movedAgainst: null,
    },
    outcome: null,
  };

  const line: ShadowLine = { ...body, lineHash: hashShadowLineBody(body) };
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(line)}\n`);
  return line;
}
