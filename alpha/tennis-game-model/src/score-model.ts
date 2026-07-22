/** Live score → logit-adjusted p_model (pure math). */

export const SCORE_CLAMP_MIN = 0.02;
export const SCORE_CLAMP_MAX = 0.98;

export const SET_LOGIT_WEIGHT = 0.35;
export const GAME_LOGIT_WEIGHT = 0.08;

export type ScoreState = {
  setsYes: number;
  setsNo: number;
  gamesYes: number;
  gamesNo: number;
  isLive: boolean;
};

export type ScoreAdjustedResult = {
  pModel: number;
  setDelta: number;
  gameDelta: number;
};

export function logit(p: number): number {
  const clamped = clampProb(p);
  return Math.log(clamped / (1 - clamped));
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function clampProb(p: number): number {
  if (p <= SCORE_CLAMP_MIN) return SCORE_CLAMP_MIN;
  if (p >= SCORE_CLAMP_MAX) return SCORE_CLAMP_MAX;
  return p;
}

export function scoreAdjustedPModel(input: {
  priorP: number;
  setsYes: number;
  setsNo: number;
  gamesYes: number;
  gamesNo: number;
  isLive: boolean;
}): ScoreAdjustedResult {
  const priorP = clampProb(input.priorP);
  const setDelta = input.setsYes - input.setsNo;
  const gameDelta = input.gamesYes - input.gamesNo;

  if (!input.isLive) {
    return { pModel: priorP, setDelta, gameDelta };
  }

  const adjustedLogit =
    logit(priorP) + setDelta * SET_LOGIT_WEIGHT + gameDelta * GAME_LOGIT_WEIGHT;
  return {
    pModel: clampProb(sigmoid(adjustedLogit)),
    setDelta,
    gameDelta,
  };
}
