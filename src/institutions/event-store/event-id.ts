import { sha3Hex } from "../evidence-chain.ts";
import { asCanonicalEventId, type CanonicalEventId, type TennisTour } from "./types.ts";

export function sortPlayerPair(a: string, b: string): [string, string] {
  const left = a.trim();
  const right = b.trim();
  return left.localeCompare(right, "en", { sensitivity: "base" }) <= 0
    ? [left, right]
    : [right, left];
}

export function mintCanonicalEventId(input: {
  tour: TennisTour;
  startTs: string;
  tournament: string;
  round: string;
  playerA: string;
  playerB: string;
}): CanonicalEventId {
  const payload = [
    input.tour,
    input.startTs.slice(0, 10),
    input.tournament.trim().toLowerCase(),
    input.round.trim().toLowerCase(),
    input.playerA.trim().toLowerCase(),
    input.playerB.trim().toLowerCase(),
  ].join("|");
  return asCanonicalEventId(sha3Hex(payload).slice(0, 32));
}

export function hashSourceRow(fields: string[]): string {
  return sha3Hex(fields.join("\t"));
}

/** 1 when playerA won, 0 when playerB won. */
export function winnerOutcomeBit(winner: string, playerA: string, playerB: string): 0 | 1 {
  const w = winner.trim().toLowerCase();
  if (w === playerA.trim().toLowerCase()) return 1;
  if (w === playerB.trim().toLowerCase()) return 0;
  throw new Error(`winner "${winner}" is neither player_a nor player_b`);
}

export function decimalToImpliedProb(decimalOdds: number): number {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) return 0;
  return 1 / decimalOdds;
}
