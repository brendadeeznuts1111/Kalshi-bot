// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { joinPath } from "../../src/research/paths.ts";
import {
  isLiveScoreStatus,
  parseKalshiLiveDataWire,
  parseKalshiMilestonesWire,
  pickTennisMilestone,
} from "../../src/bot/kalshi-live-data.ts";
import { asCompetitorId, asMilestoneId } from "../../src/institutions/event-store/brands.ts";

const FIXTURE = joinPath(import.meta.dir, "../fixtures/kalshi-live-data.json");
const competitor1Id = asCompetitorId("9eface64-a579-436d-8717-50f2730400e2");

describe("kalshi-live-data", () => {
  test("milestones + live wire", async () => {
    const fx = await Bun.file(FIXTURE).json();
    const milestones = parseKalshiMilestonesWire(fx.milestones);
    expect(milestones).toHaveLength(1);
    expect(pickTennisMilestone(milestones)?.id).toEqual(
      asMilestoneId("ccf4cd8d-78a4-4dba-8d4e-e680d8753895"),
    );
    expect(milestones[0]!.firstCompetitorId).toEqual(competitor1Id);

    const idle = parseKalshiLiveDataWire(fx.live_data_not_started)!;
    expect(idle.status).toBe("not_started");
    expect(isLiveScoreStatus(idle.status, idle)).toBe(false);

    const live = parseKalshiLiveDataWire(fx.live_data_in_progress)!;
    expect(live.pointsHome).toBe(30);
    expect(live.gamesHome).toBe(2);
    expect(live.gamesAway).toBe(1);
    expect(live.serverSide).toBe(1);
    expect(isLiveScoreStatus(live.status, live)).toBe(true);
  });

  test("early-start via points while status still not_started", () => {
    expect(
      isLiveScoreStatus("not_started", {
        setsHome: 0,
        setsAway: 0,
        gamesHome: 0,
        gamesAway: 0,
        pointsHome: 15,
        pointsAway: 0,
        serverCompetitorId: null,
      }),
    ).toBe(true);
  });
});
