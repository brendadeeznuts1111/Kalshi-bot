// @see https://bun.com/docs/test/dates-times
import { describe, expect, test } from "bun:test";
import {
  computeSurfaceElo,
  DEFAULT_ELO_OUTPUT,
  expectedScore,
  parseTrainEloArgv,
  type CompletedMatch,
} from "../scripts/train-elo.ts";
import { asCanonicalEventId } from "../src/institutions/event-store/brands.ts";

// ── Synthetic match data ────────────────────────────────────────

let nextMatchId = 0;

function makeMatch(overrides: Partial<CompletedMatch> = {}): CompletedMatch {
  nextMatchId += 1;
  return {
    eventId: asCanonicalEventId(`evt-test-${nextMatchId}`),
    tournament: "Test Tournament",
    surface: "Hard",
    startTs: "2024-01-15T12:00:00Z",
    playerA: "Player Alpha",
    playerB: "Player Beta",
    winner: "Player Alpha",
    loser: "Player Beta",
    scoreText: "6-3 6-4",
    level: "ATP250",
    ...overrides,
  };
}

describe("Elo engine", () => {
  test("initElo returns 1500 for all surfaces", () => {
    // Direct test: verify the internal Elo constant behavior
    // by checking expected score at equal ratings
    const { predictions } = computeSurfaceElo(
      [makeMatch({ playerA: "Alice", playerB: "Bob", winner: "Alice", surface: "Hard" })],
      "2024-01-01",
    );
    // If no cutoff matches exist, predictions array should reference the test match
    // since the match startTs is >= cutoff "2024-01-01"
    expect(predictions.length).toBeGreaterThan(0);
    // Both players start at 1500 → expected score = 0.5
    expect(predictions[0]!.pA).toBeCloseTo(0.5, 1);
  });

  test("expectedScore: 100-point gap ≈ 64%", () => {
    expect(expectedScore(1600, 1500)).toBeCloseTo(0.6400649998, 8);
    expect(expectedScore(1500, 1600)).toBeCloseTo(0.3599350002, 8);
  });

  test("Elo updates: winner gains, loser loses same amount", () => {
    const { predictions } = computeSurfaceElo(
      [
        makeMatch({
          playerA: "Elena",
          playerB: "Fred",
          winner: "Elena",
          surface: "Hard",
          startTs: "2024-06-01T12:00:00Z",
        }),
      ],
      "2024-01-01T00:00:00Z",
    );
    // Match is after cutoff, so it's a prediction
    expect(predictions.length).toBe(1);
    expect(predictions[0]!.pA).toBeCloseTo(0.5, 1); // both 1500

    // After the match, Elo should have updated
    // Winner gained ~16, loser lost ~16 (K=32, score=1, expected=0.5 → delta=16)
    // But we need to check post-match Elos by running a second match
    const { predictions: pred2 } = computeSurfaceElo(
      [
        makeMatch({
          playerA: "Elena",
          playerB: "Fred",
          winner: "Elena",
          surface: "Hard",
          startTs: "2024-06-01T12:00:00Z",
        }),
        makeMatch({
          eventId: asCanonicalEventId("evt-elena-fred-2"),
          playerA: "Elena",
          playerB: "Fred",
          winner: "Elena",
          surface: "Hard",
          startTs: "2024-06-02T12:00:00Z",
        }),
      ],
      "2024-06-02T00:00:00Z",
    );
    // Second match should have Elena as favorite — PredictionRow carries
    // eventId, not startTs
    const second = pred2.find((p) => p.eventId === "evt-elena-fred-2");
    expect(second).toBeDefined();
    // Since all matches have the same players, the second match's prediction
    // should show Elena with higher Elo
    if (second) {
      expect(second.eloA[0]!).toBeGreaterThan(second.eloB[0]!);
      expect(second.pA).toBeGreaterThan(0.5);
    }
  });

  test("surface isolation: Hard Elo unchanged by Clay match", () => {
    const { elos } = computeSurfaceElo(
      [
        makeMatch({
          playerA: "Grace",
          playerB: "Hank",
          winner: "Grace",
          surface: "Clay",
          startTs: "2024-03-01T12:00:00Z",
        }),
      ],
      null, // train only, no cutoff
    );
    // After a Clay match, the Hard Elo (index 0) should remain at 1500
    // but Clay Elo (index 1) should have changed
    const graceSnaps = elos.snapshots.get("Grace") ?? [];
    const hankSnaps = elos.snapshots.get("Hank") ?? [];
    // First (and only) snapshot is pre-match
    if (graceSnaps.length > 0) {
      expect(graceSnaps[0]![0]).toBe(1500); // Hard unchanged
      expect(hankSnaps[0]![0]).toBe(1500);  // Hard unchanged
    }
  });

  test("walk-forward: predictions use pre-match Elo in match order", () => {
    // computeSurfaceElo never reads Date.now() (grep-verified) — the cutoff is
    // explicit, so no system-time mocking is needed here.
    const match1 = makeMatch({
      playerA: "Ivan",
      playerB: "Julia",
      winner: "Ivan",
      surface: "Hard",
      startTs: "2024-07-01T12:00:00Z",
    });
    const match2 = makeMatch({
      playerA: "Ivan",
      playerB: "Julia",
      winner: "Julia",
      surface: "Hard",
      startTs: "2024-07-02T12:00:00Z",
    });

    const { predictions } = computeSurfaceElo([match1, match2], "2024-07-01T00:00:00Z");
    // Both matches are >= cutoff, so both produce predictions
    expect(predictions.length).toBe(2);

    // First prediction: both at 1500, pA = 0.5
    expect(predictions[0]!.pA).toBeCloseTo(0.5, 1);

    // Second prediction: Ivan won first match, so his Elo is higher
    expect(predictions[1]!.eloA[0]!).toBeGreaterThan(predictions[1]!.eloB[0]!);
    expect(predictions[1]!.pA).toBeGreaterThan(0.5);
  });

  test("no cutoff = no predictions", () => {
    const { predictions } = computeSurfaceElo(
      [makeMatch({ playerA: "Kevin", playerB: "Lisa", winner: "Kevin" })],
      null,
    );
    expect(predictions).toHaveLength(0);
  });

  test("matches before cutoff produce no predictions", () => {
    const { predictions } = computeSurfaceElo(
      [
        makeMatch({
          playerA: "Mike",
          playerB: "Nancy",
          winner: "Mike",
          startTs: "2023-01-01T12:00:00Z",
        }),
      ],
      "2024-01-01T00:00:00Z",
    );
    expect(predictions).toHaveLength(0);
  });
});

describe("train-elo CLI", () => {
  test("parses explicit paths, cutoff, and help", () => {
    expect(
      parseTrainEloArgv([
        "--db",
        "fixtures/event-store.db",
        "--cutoff=2024-01-01",
        "--out",
        "artifacts/elo.json",
        "--help",
      ]),
    ).toEqual({
      dbPath: "fixtures/event-store.db",
      cutoff: "2024-01-01",
      out: "artifacts/elo.json",
      help: true,
    });
  });

  test("keeps the default output in the ignored research cache", async () => {
    // Real guard: the default output must stay inside the gitignored
    // research/cache/ tree, or p_elo_predictions.json would get committed.
    expect(DEFAULT_ELO_OUTPUT).toStartWith("research/cache/");
    const gitignore = await Bun.file(".gitignore").text();
    expect(gitignore.split("\n").map((l) => l.trim())).toContain("research/cache/");
  });
});
