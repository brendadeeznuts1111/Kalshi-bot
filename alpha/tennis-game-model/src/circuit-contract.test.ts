// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  assertPermittedSignalComponents,
  EXCLUDED_NOISE_FIELDS,
  MODEL_INPUT_COMPONENTS,
  TENNIS_GAME_MODEL_PROPERTY_GROUPS,
  tennisGameModelContractSnapshot,
} from "./circuit-contract.ts";
import {
  DEFAULT_UNKNOWN_STRENGTH,
  MATCH_WEIGHT_GAMES,
  PRIOR_UNITS,
} from "./player-strengths.ts";

describe("tennis-game-model circuit contract", () => {
  test("separates causal inputs from decision observations and excluded noise", () => {
    const contract = tennisGameModelContractSnapshot();
    expect(contract).toMatchSnapshot();
    expect(contract.dataPolicy).toEqual({
      fitCorpus: "trading",
      excludedCorpus: "research-only",
      evaluationClock: "book receive timestamp",
      outcomeCutoff: "event start and resolution timestamps must be at or before asOfMs",
      marketPriceRole: "decision observation only; never a pModel input",
      noisePolicy: "diagnostic-only fields may not appear in the signal component map",
    });
    expect(contract.componentGroups.modelInput).toEqual(MODEL_INPUT_COMPONENTS);
    expect(contract.componentGroups.decisionObservation).toContain("market_mid_current");
    expect(EXCLUDED_NOISE_FIELDS).toContain("latency_ms");
    expect(contract.weightPolicy.parameters).toEqual([
      "PRIOR_UNITS",
      "MATCH_WEIGHT_GAMES",
      "DEFAULT_UNKNOWN_STRENGTH",
    ]);
    expect([PRIOR_UNITS, MATCH_WEIGHT_GAMES, DEFAULT_UNKNOWN_STRENGTH].every(Number.isFinite)).toBe(true);
    expect(TENNIS_GAME_MODEL_PROPERTY_GROUPS.map(group => group.id)).toEqual([
      "package-identity",
      "tenant-runtime",
      "circuit",
      "execution-observation",
      "environment-and-flags",
    ]);
  });

  test("package runtime commands remain shadow and contract oriented", async () => {
    const pkg = (await Bun.file(`${import.meta.dir}/../package.json`).json()) as {
      name: unknown;
      private: unknown;
      type: unknown;
      scripts: Record<string, unknown>;
    };
    expect(pkg.name).toBe("tennis-game-model");
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe("module");
    expect(pkg.scripts["run-once"]).toBe("bun src/run-once.ts");
    expect(pkg.scripts["run-watch"]).toBe("bun src/run-watch.ts");
    expect(pkg.scripts.backtest).toBe("bun src/backtest.ts");
  });

  test("rejects unknown, non-causal, and non-finite signal components", () => {
    expect(() => assertPermittedSignalComponents({ self_prior: 0.5, latency_ms: 17 })).toThrow(
      "Unapproved tennis-game-model component: latency_ms",
    );
    expect(() => assertPermittedSignalComponents({ self_prior: Number.NaN })).toThrow(
      "Invalid tennis-game-model component self_prior",
    );
    expect(() => assertPermittedSignalComponents({ self_prior: 0.5, market_mid_current: 0.51 })).not.toThrow();
  });
});
