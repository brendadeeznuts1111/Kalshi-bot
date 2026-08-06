import type {
  PolymarketEvent,
  PolymarketMarket,
} from "../../regulatory/integrations/polymarket.ts";
import { classifyPolymarketEventSemantics } from "../market-registry/adapters/polymarket-gamma.ts";
import type {
  CompetitionBinding,
} from "../market-registry/types.ts";
import type { SeriesTicker } from "./brands.ts";
import {
  kalshiReconciliationSemanticsForSeries,
  type ResolvedEventSemantics,
} from "../market-registry/registry.ts";

const GENERIC_OUTCOMES = new Set(["yes", "no", "over", "under"]);
const PROP_QUESTION =
  /completed match|o\/u|set \d|set handicap|games|total sets|tie ?break/i;
const TOURNAMENT_STOP_WORDS = new Set([
  "atp",
  "wta",
  "itf",
  "men",
  "women",
  "open",
  "qualification",
  "qualifying",
  "doubles",
]);
const FUZZY_NAME_MIN_SCORE = 0.88;

export type KalshiMatchTarget = {
  ticker: string;
  playerA: string;
  playerB: string;
  date: string | null;
  tournament?: string;
  series: SeriesTicker;
};

export type PolymarketMatchMethod =
  | "surname"
  | "fuzzy-name"
  | "date-tournament";

export type PolymarketMatch = {
  event: PolymarketEvent;
  market: PolymarketMarket;
  /** Index in market.outcomes corresponding to Kalshi player A. */
  playerAOutcomeIndex: number;
  method: PolymarketMatchMethod;
};

type Candidate = PolymarketMatch & {
  dateExact: boolean;
  tournamentExact: boolean;
  distance: number;
};

export function normalizeTennisName(value: string): string {
  return value
    .replace(/\([^)]*\)/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // These Latin letters do not decompose under NFD.
    .replace(/[łđðþø]/g, (letter) =>
      ({ ł: "l", đ: "d", ð: "d", þ: "th", ø: "o" })[letter]!,
    )
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tennisSurname(value: string): string {
  const parts = normalizeTennisName(value).split(" ").filter(Boolean);
  return parts.at(-1) ?? "";
}

export function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length]!;
}

/** Prefix-aware similarity for short, transposed, or truncated tennis names. */
export function jaroWinkler(left: string, right: string): number {
  if (left === right) return 1;
  if (!left || !right) return 0;

  const matchDistance = Math.max(0, Math.floor(Math.max(left.length, right.length) / 2) - 1);
  const leftMatches = new Array<boolean>(left.length).fill(false);
  const rightMatches = new Array<boolean>(right.length).fill(false);
  let matches = 0;

  for (let i = 0; i < left.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, right.length);
    for (let j = start; j < end; j++) {
      if (rightMatches[j] || left[i] !== right[j]) continue;
      leftMatches[i] = true;
      rightMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let rightIndex = 0;
  for (let i = 0; i < left.length; i++) {
    if (!leftMatches[i]) continue;
    while (!rightMatches[rightIndex]) rightIndex++;
    if (left[i] !== right[rightIndex]) transpositions++;
    rightIndex++;
  }

  const jaro =
    (matches / left.length +
      matches / right.length +
      (matches - transpositions / 2) / matches) /
    3;
  let prefixLength = 0;
  while (
    prefixLength < 4 &&
    prefixLength < left.length &&
    prefixLength < right.length &&
    left[prefixLength] === right[prefixLength]
  ) {
    prefixLength++;
  }
  return jaro + prefixLength * 0.1 * (1 - jaro);
}

/** Sørensen-Dice character n-gram overlap. */
export function diceCoefficient(left: string, right: string, gramSize = 2): number {
  if (left === right) return 1;
  if (!left || !right || gramSize < 1) return 0;
  if (left.length < gramSize || right.length < gramSize) return 0;

  const grams = new Map<string, number>();
  for (let i = 0; i <= left.length - gramSize; i++) {
    const gram = left.slice(i, i + gramSize);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i <= right.length - gramSize; i++) {
    const gram = right.slice(i, i + gramSize);
    const remaining = grams.get(gram) ?? 0;
    if (remaining === 0) continue;
    overlap++;
    grams.set(gram, remaining - 1);
  }
  const leftCount = left.length - gramSize + 1;
  const rightCount = right.length - gramSize + 1;
  return (2 * overlap) / (leftCount + rightCount);
}

function nameTokens(value: string): string[] {
  return normalizeTennisName(value).split(" ").filter(Boolean);
}

function sameTokenSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((token, index) => token === sortedRight[index]);
}

function isTokenSubset(shorter: readonly string[], longer: readonly string[]): boolean {
  return shorter.length >= 2 && shorter.every((token) => longer.includes(token));
}

/**
 * Tennis-name similarity with explicit handling for initials, reordered names,
 * compound surnames, diacritics, truncation, and small spelling errors.
 */
export function tennisNameSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeTennisName(left);
  const normalizedRight = normalizeTennisName(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;

  const leftTokens = nameTokens(normalizedLeft);
  const rightTokens = nameTokens(normalizedRight);
  if (sameTokenSet(leftTokens, rightTokens)) return 0.995;
  if (
    isTokenSubset(leftTokens, rightTokens) ||
    isTokenSubset(rightTokens, leftTokens)
  ) {
    return 0.96;
  }

  const leftFirst = leftTokens[0] ?? "";
  const rightFirst = rightTokens[0] ?? "";
  const leftSurname = leftTokens.at(-1) ?? "";
  const rightSurname = rightTokens.at(-1) ?? "";
  if (
    leftSurname === rightSurname &&
    leftFirst[0] !== undefined &&
    leftFirst[0] === rightFirst[0]
  ) {
    return 0.98;
  }

  const editScore =
    1 - levenshtein(normalizedLeft, normalizedRight) /
      Math.max(normalizedLeft.length, normalizedRight.length);
  return Math.max(
    editScore,
    jaroWinkler(normalizedLeft, normalizedRight),
    diceCoefficient(normalizedLeft, normalizedRight, 2),
    diceCoefficient(normalizedLeft, normalizedRight, 3),
  );
}

export function polymarketSlugCodes(slug: string): [string, string] | null {
  const match = slug.match(
    /^(?:atp|wta|itf)(?:-doubles)?-([a-z0-9]+)-([a-z0-9]+)-\d{4}-\d{2}-\d{2}$/,
  );
  return match ? [match[1]!, match[2]!] : null;
}

export function polymarketSlugDate(slug: string): string | null {
  const match = slug.match(/-(\d{4}-\d{2}-\d{2})$/);
  if (!match) return null;
  const value = match[1]!;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return null;
  }
  return value;
}

function moneylineMarkets(event: PolymarketEvent): PolymarketMarket[] {
  const eventTitle = normalizeTennisName(event.title);
  return event.markets
    .filter((market) => market.active && !market.closed)
    .filter((market) => market.sportsMarketType === "moneyline")
    .filter((market) => !PROP_QUESTION.test(market.question))
    .filter((market) => market.outcomes.length === 2 && market.outcomePrices.length === 2)
    .filter(
      (market) =>
        !market.outcomes.some((outcome) =>
          GENERIC_OUTCOMES.has(normalizeTennisName(outcome)),
        ),
    )
    .sort((left, right) => {
      const leftPrimary = normalizeTennisName(left.question) === eventTitle ? 1 : 0;
      const rightPrimary = normalizeTennisName(right.question) === eventTitle ? 1 : 0;
      return rightPrimary - leftPrimary;
    });
}

function codeMatchesSurname(code: string, surname: string): boolean {
  if (!code || !surname) return false;
  return surname.startsWith(code) || code.startsWith(surname);
}

function tournamentTokens(value: string): Set<string> {
  return new Set(
    normalizeTennisName(value)
      .split(" ")
      .filter(
        (token) =>
          token.length > 2 &&
          !TOURNAMENT_STOP_WORDS.has(token) &&
          !/^[mw]\d+$/.test(token) &&
          !/^\d+$/.test(token),
      ),
  );
}

function tournamentMatches(target: string | undefined, event: PolymarketEvent): boolean {
  if (!target) return false;
  const eventTournament = event.title.split(":", 1)[0] ?? event.title;
  const left = tournamentTokens(target);
  const right = tournamentTokens(eventTournament);
  return [...left].some((token) => right.has(token));
}

function pairOrientation(
  targetA: string,
  targetB: string,
  outcomeA: string,
  outcomeB: string,
  compare: (target: string, outcome: string) => boolean,
): 0 | 1 | null {
  if (compare(targetA, outcomeA) && compare(targetB, outcomeB)) return 0;
  if (compare(targetA, outcomeB) && compare(targetB, outcomeA)) return 1;
  return null;
}

function chooseUnique(candidates: Candidate[]): Candidate | null {
  if (candidates.length === 0) return null;
  const ranked = candidates.sort(
    (left, right) =>
      Number(right.dateExact) - Number(left.dateExact) ||
      Number(right.tournamentExact) - Number(left.tournamentExact) ||
      left.distance - right.distance,
  );
  const first = ranked[0]!;
  const second = ranked[1];
  if (
    second &&
    first.dateExact === second.dateExact &&
    first.tournamentExact === second.tournamentExact &&
    first.distance === second.distance
  ) {
    return null;
  }
  return first;
}

function candidateBase(
  target: KalshiMatchTarget,
  event: PolymarketEvent,
  market: PolymarketMarket,
  playerAOutcomeIndex: 0 | 1,
  method: PolymarketMatchMethod,
  distance: number,
): Candidate {
  return {
    event,
    market,
    playerAOutcomeIndex,
    method,
    dateExact: target.date !== null && polymarketSlugDate(event.slug) === target.date,
    tournamentExact: tournamentMatches(target.tournament, event),
    distance,
  };
}

function semanticLaneMatches(
  target: KalshiMatchTarget & ResolvedEventSemantics,
  event: PolymarketEvent,
  binding: CompetitionBinding,
): boolean {
  const semantics = classifyPolymarketEventSemantics(event, binding);
  return (
    semantics.disposition === "resolved" &&
    semantics.eventType === target.eventType &&
    semantics.participantFormat === target.participantFormat
  );
}

/** Three-tier event reconciliation with ambiguity rejection at every tier. */
export function findPolymarketMatch(
  target: KalshiMatchTarget,
  events: readonly PolymarketEvent[],
  binding: CompetitionBinding,
): PolymarketMatch | null {
  const targetSemantics = kalshiReconciliationSemanticsForSeries(target.series);
  if (!targetSemantics || binding.selector.sport !== targetSemantics.sport) return null;
  const targetSurnameA = tennisSurname(target.playerA);
  const targetSurnameB = tennisSurname(target.playerB);

  const surnameCandidates: Candidate[] = [];
  for (const event of events) {
    if (!semanticLaneMatches({ ...target, ...targetSemantics }, event, binding)) continue;
    const eventDate = polymarketSlugDate(event.slug);
    if (target.date && eventDate && target.date !== eventDate) continue;
    const codes = polymarketSlugCodes(event.slug);
    for (const market of moneylineMarkets(event)) {
      const outcomes = market.outcomes;
      const orientation = pairOrientation(
        targetSurnameA,
        targetSurnameB,
        tennisSurname(outcomes[0]!),
        tennisSurname(outcomes[1]!),
        (targetName, outcomeName) => targetName === outcomeName,
      );
      const slugOrientation = codes
        ? pairOrientation(
            targetSurnameA,
            targetSurnameB,
            codes[0],
            codes[1],
            codeMatchesSurname,
          )
        : null;
      const resolved = orientation ?? slugOrientation;
      if (resolved !== null) {
        surnameCandidates.push(
          candidateBase(target, event, market, resolved, "surname", 0),
        );
        break;
      }
    }
  }
  const surnameMatch = chooseUnique(surnameCandidates);
  if (surnameMatch) return surnameMatch;

  const normalizedA = normalizeTennisName(target.playerA);
  const normalizedB = normalizeTennisName(target.playerB);
  const fuzzyCandidates: Candidate[] = [];
  for (const event of events) {
    if (!semanticLaneMatches({ ...target, ...targetSemantics }, event, binding)) continue;
    const eventDate = polymarketSlugDate(event.slug);
    if (target.date && eventDate && target.date !== eventDate) continue;
    for (const market of moneylineMarkets(event)) {
      const [outcomeA, outcomeB] = market.outcomes.map(normalizeTennisName);
      const forwardScores = [
        tennisNameSimilarity(normalizedA, outcomeA!),
        tennisNameSimilarity(normalizedB, outcomeB!),
      ];
      const reverseScores = [
        tennisNameSimilarity(normalizedA, outcomeB!),
        tennisNameSimilarity(normalizedB, outcomeA!),
      ];
      const forwardValid = Math.min(...forwardScores) >= FUZZY_NAME_MIN_SCORE;
      const reverseValid = Math.min(...reverseScores) >= FUZZY_NAME_MIN_SCORE;
      if (!forwardValid && !reverseValid) continue;
      const forward = forwardScores[0]! + forwardScores[1]!;
      const reverse = reverseScores[0]! + reverseScores[1]!;
      if (forwardValid && reverseValid && forward === reverse) continue;
      const orientation = forwardValid && (!reverseValid || forward > reverse) ? 0 : 1;
      const scores = orientation === 0 ? forwardScores : reverseScores;
      fuzzyCandidates.push(
        candidateBase(
          target,
          event,
          market,
          orientation,
          "fuzzy-name",
          Math.round((2 - scores[0]! - scores[1]!) * 10_000),
        ),
      );
      break;
    }
  }
  const fuzzyMatch = chooseUnique(fuzzyCandidates);
  if (fuzzyMatch) return fuzzyMatch;

  if (!target.date || !target.tournament) return null;
  const fallbackCandidates: Candidate[] = [];
  for (const event of events) {
    if (!semanticLaneMatches({ ...target, ...targetSemantics }, event, binding)) continue;
    if (polymarketSlugDate(event.slug) !== target.date) continue;
    if (!tournamentMatches(target.tournament, event)) continue;
    const market = moneylineMarkets(event)[0];
    if (!market) continue;
    const [outcomeA, outcomeB] = market.outcomes;
    const outcomeSurnameA = tennisSurname(outcomeA!);
    const outcomeSurnameB = tennisSurname(outcomeB!);
    const forwardDistances = [
      levenshtein(targetSurnameA, outcomeSurnameA),
      levenshtein(targetSurnameB, outcomeSurnameB),
    ];
    const reverseDistances = [
      levenshtein(targetSurnameA, outcomeSurnameB),
      levenshtein(targetSurnameB, outcomeSurnameA),
    ];
    const forward = forwardDistances[0]! + forwardDistances[1]!;
    const reverse = reverseDistances[0]! + reverseDistances[1]!;
    if (forward === reverse) continue;
    const orientation = forward < reverse ? 0 : 1;
    const distances = orientation === 0 ? forwardDistances : reverseDistances;
    // Tournament/date alone identifies a session, not a match. Require a
    // bounded surname signal before assigning either outcome probability.
    if (Math.max(...distances) > 2) continue;
    fallbackCandidates.push(
      candidateBase(
        target,
        event,
        market,
        orientation,
        "date-tournament",
        distances[0]! + distances[1]!,
      ),
    );
  }
  return chooseUnique(fallbackCandidates);
}
