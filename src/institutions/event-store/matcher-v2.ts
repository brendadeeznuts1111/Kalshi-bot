import type {
  PolymarketEvent,
  PolymarketMarket,
} from "../../regulatory/integrations/polymarket.ts";

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

export type KalshiMatchTarget = {
  ticker: string;
  playerA: string;
  playerB: string;
  date: string | null;
  tournament?: string;
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

function doublesLaneMatches(target: KalshiMatchTarget, event: PolymarketEvent): boolean {
  const targetDoubles =
    /doubles/i.test(target.ticker) ||
    target.playerA.includes("/") ||
    target.playerB.includes("/");
  const eventDoubles = /^(?:atp|wta|itf)-doubles-/.test(event.slug);
  return targetDoubles === eventDoubles;
}

/** Three-tier event reconciliation with ambiguity rejection at every tier. */
export function findPolymarketMatch(
  target: KalshiMatchTarget,
  events: readonly PolymarketEvent[],
): PolymarketMatch | null {
  const targetSurnameA = tennisSurname(target.playerA);
  const targetSurnameB = tennisSurname(target.playerB);

  const surnameCandidates: Candidate[] = [];
  for (const event of events) {
    if (!doublesLaneMatches(target, event)) continue;
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
    if (!doublesLaneMatches(target, event)) continue;
    const eventDate = polymarketSlugDate(event.slug);
    if (target.date && eventDate && target.date !== eventDate) continue;
    for (const market of moneylineMarkets(event)) {
      const [outcomeA, outcomeB] = market.outcomes.map(normalizeTennisName);
      const forwardA = levenshtein(normalizedA, outcomeA!);
      const forwardB = levenshtein(normalizedB, outcomeB!);
      const reverseA = levenshtein(normalizedA, outcomeB!);
      const reverseB = levenshtein(normalizedB, outcomeA!);
      const forward = forwardA + forwardB;
      const reverse = reverseA + reverseB;
      const orientation = forward <= reverse ? 0 : 1;
      const distances = orientation === 0 ? [forwardA, forwardB] : [reverseA, reverseB];
      if (Math.max(...distances) >= 3) continue;
      fuzzyCandidates.push(
        candidateBase(
          target,
          event,
          market,
          orientation,
          "fuzzy-name",
          distances[0]! + distances[1]!,
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
    if (!doublesLaneMatches(target, event)) continue;
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
