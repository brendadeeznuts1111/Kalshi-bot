/**
 * Point → game → set → match win probability (symmetric hold strength v1).
 * Pure math — no DB. ITF/Challenger default best-of-3.
 */

export const PROB_CLAMP_MIN = 0.02;
export const PROB_CLAMP_MAX = 0.98;

export type MatchScoreState = {
  setsYes: number;
  setsNo: number;
  gamesYes: number;
  gamesNo: number;
  /** Game points on server / returner side of current game (0–4+ Kalshi wire). */
  pointsServer: number;
  pointsReturner: number;
  /** YES player serving the current point. */
  serverIsYes: boolean;
  bestOf: 3 | 5;
};

export function clampProb(p: number): number {
  if (p <= PROB_CLAMP_MIN) return PROB_CLAMP_MIN;
  if (p >= PROB_CLAMP_MAX) return PROB_CLAMP_MAX;
  return p;
}

/** Terminal game value for states beyond the memo cap (deep games). */
function gameTerminal(s: number, r: number): number {
  if (s >= 4 && s - r >= 2) return 1;
  if (r >= 4 && r - s >= 2) return 0;
  return 0.5;
}

function gameWinProbTable(pPoint: number, maxPoints: number): Map<string, number> {
  const p = clampProb(pPoint);
  const memo = new Map<string, number>();
  for (let sum = maxPoints * 2; sum >= 0; sum--) {
    for (let s = 0; s <= sum && s <= maxPoints; s++) {
      const r = sum - s;
      if (r < 0 || r > maxPoints) continue;
      if (s >= 4 && s - r >= 2) {
        memo.set(`${s},${r}`, 1);
        continue;
      }
      if (r >= 4 && r - s >= 2) {
        memo.set(`${s},${r}`, 0);
        continue;
      }
      if (s === maxPoints && r === maxPoints) {
        // Cap the deep-deuce chain at its closed-form value — recursing past the
        // cap would silently treat surviving mass as lost.
        memo.set(`${s},${r}`, (p * p) / (p * p + (1 - p) * (1 - p)));
        continue;
      }
      const win =
        (memo.get(`${s + 1},${r}`) ?? gameTerminal(s + 1, r)) * p +
        (memo.get(`${s},${r + 1}`) ?? gameTerminal(s, r + 1)) * (1 - p);
      memo.set(`${s},${r}`, win);
    }
  }
  return memo;
}

/** P(server wins current game) from point score and per-point win prob p. */
export function probServerWinsGame(pPoint: number, pointsServer: number, pointsReturner: number): number {
  const table = gameWinProbTable(pPoint, 10);
  return table.get(`${Math.max(0, pointsServer)},${Math.max(0, pointsReturner)}`) ?? 0.5;
}

/** P(YES wins tiebreak) — alternating serve (1st server takes point 0, then every 2). */
export function probYesWinsTiebreak(
  pHoldYes: number,
  pHoldNo: number,
  yesServesFirst: boolean,
): number {
  const memo = new Map<string, number>();
  const MAX = 16;
  for (let sum = MAX * 2; sum >= 0; sum--) {
    for (let s = 0; s <= sum && s <= MAX; s++) {
      const r = sum - s;
      if (r < 0 || r > MAX) continue;
      if (s >= 7 && s - r >= 2) {
        memo.set(`${s},${r}`, 1);
        continue;
      }
      if (r >= 7 && r - s >= 2) {
        memo.set(`${s},${r}`, 0);
        continue;
      }
      const n = s + r;
      const aServes = n === 0 || Math.ceil(n / 2) % 2 === 0;
      const yesServes = yesServesFirst ? aServes : !aServes;
      const p = clampProb(yesServes ? pHoldYes : 1 - pHoldNo);
      const win =
        (memo.get(`${s + 1},${r}`) ?? gameTerminal(s + 1, r)) * p +
        (memo.get(`${s},${r + 1}`) ?? gameTerminal(s, r + 1)) * (1 - p);
      memo.set(`${s},${r}`, win);
    }
  }
  return memo.get("0,0") ?? 0.5;
}

function setsToWin(bestOf: 3 | 5): number {
  return Math.ceil(bestOf / 2);
}

function probWinSetFromGamesMemo(
  gamesYes: number,
  gamesNo: number,
  serverIsYes: boolean,
  pHoldYes: number,
  pHoldNo: number,
  pointsYes: number,
  pointsNo: number,
  memo: Map<string, number>,
): number {
  if (gamesYes >= 6 && gamesYes - gamesNo >= 2) return 1;
  if (gamesNo >= 6 && gamesNo - gamesYes >= 2) return 0;

  const key = `${gamesYes},${gamesNo},${serverIsYes ? 1 : 0},${pointsYes},${pointsNo}`;
  const hit = memo.get(key);
  if (hit != null) return hit;

  let val: number;
  if (gamesYes === 6 && gamesNo === 6) {
    // serverIsYes = YES serves the first tiebreak point.
    val = probYesWinsTiebreak(pHoldYes, pHoldNo, serverIsYes);
  } else {
    // When NO serves, 1 − P(NO holds) is ALREADY P(YES wins the game) — no second inversion.
    const pYesWinsGame = serverIsYes
      ? probServerWinsGame(pHoldYes, pointsYes, pointsNo)
      : 1 - probServerWinsGame(pHoldNo, pointsNo, pointsYes);
    const nextServerIsYes = !serverIsYes;
    const pIfYesWins = probWinSetFromGamesMemo(
      gamesYes + 1,
      gamesNo,
      nextServerIsYes,
      pHoldYes,
      pHoldNo,
      0,
      0,
      memo,
    );
    const pIfYesLoses = probWinSetFromGamesMemo(
      gamesYes,
      gamesNo + 1,
      nextServerIsYes,
      pHoldYes,
      pHoldNo,
      0,
      0,
      memo,
    );
    val = pYesWinsGame * pIfYesWins + (1 - pYesWinsGame) * pIfYesLoses;
  }

  memo.set(key, val);
  return val;
}

function probWinMatchFromSetsMemo(
  setsYes: number,
  setsNo: number,
  gamesYes: number,
  gamesNo: number,
  serverIsYes: boolean,
  pHoldYes: number,
  pHoldNo: number,
  pointsYes: number,
  pointsNo: number,
  bestOf: 3 | 5,
  setMemo: Map<string, number>,
  matchMemo: Map<string, number>,
): number {
  const need = setsToWin(bestOf);
  if (setsYes >= need) return 1;
  if (setsNo >= need) return 0;

  const key = `${setsYes},${setsNo},${gamesYes},${gamesNo},${serverIsYes ? 1 : 0},${pointsYes},${pointsNo}`;
  const hit = matchMemo.get(key);
  if (hit != null) return hit;

  const pSet = probWinSetFromGamesMemo(
    gamesYes,
    gamesNo,
    serverIsYes,
    pHoldYes,
    pHoldNo,
    pointsYes,
    pointsNo,
    setMemo,
  );
  const nextServer = !serverIsYes;
  const pIfYesWinsSet = probWinMatchFromSetsMemo(
    setsYes + 1,
    setsNo,
    0,
    0,
    nextServer,
    pHoldYes,
    pHoldNo,
    0,
    0,
    bestOf,
    setMemo,
    matchMemo,
  );
  const pIfYesLosesSet = probWinMatchFromSetsMemo(
    setsYes,
    setsNo + 1,
    0,
    0,
    nextServer,
    pHoldYes,
    pHoldNo,
    0,
    0,
    bestOf,
    setMemo,
    matchMemo,
  );

  const val = clampProb(pSet * pIfYesWinsSet + (1 - pSet) * pIfYesLosesSet);
  matchMemo.set(key, val);
  return val;
}

/** P(YES wins match) from live score state and hold probs derived from opening prior. */
export function matchWinProbYes(state: MatchScoreState, pHoldYes: number, pHoldNo: number): number {
  const pointsYes = state.serverIsYes ? state.pointsServer : state.pointsReturner;
  const pointsNo = state.serverIsYes ? state.pointsReturner : state.pointsServer;

  return probWinMatchFromSetsMemo(
    state.setsYes,
    state.setsNo,
    state.gamesYes,
    state.gamesNo,
    state.serverIsYes,
    clampProb(pHoldYes),
    clampProb(pHoldNo),
    pointsYes,
    pointsNo,
    state.bestOf,
    new Map(),
    new Map(),
  );
}

/**
 * Baseline per-point serve win prob (ITF/Challenger ≈ 0.62). Hold strengths are
 * expressed as a symmetric differential around this anchor: the opening prior
 * moves the PAIR apart; it cannot move a single symmetric hold off 0.5.
 */
export const BASE_SERVE_POINT_WIN = 0.62;

export type HoldPair = { pHoldYes: number; pHoldNo: number };

/**
 * Binary-search the hold differential so pre-match P(YES) ≈ priorP with YES
 * serving first. priorP = 0.5 → identical holds at the baseline anchor.
 */
export function inferHoldsFromMatchPrior(priorP: number, bestOf: 3 | 5 = 3): HoldPair {
  const target = clampProb(priorP);
  const base = BASE_SERVE_POINT_WIN;
  let lo = 0;
  let hi = 0.25;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const pMatch = matchWinProbYes(
      {
        setsYes: 0,
        setsNo: 0,
        gamesYes: 0,
        gamesNo: 0,
        pointsServer: 0,
        pointsReturner: 0,
        serverIsYes: true,
        bestOf,
      },
      base + mid,
      base - mid,
    );
    if (pMatch < target) lo = mid;
    else hi = mid;
  }
  const d = (lo + hi) / 2;
  return { pHoldYes: clampProb(base + d), pHoldNo: clampProb(base - d) };
}
