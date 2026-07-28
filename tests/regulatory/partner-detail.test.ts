/**
 * tests/regulatory/partner-detail.test.ts
 *
 * API tests for the ops dashboard partner detail route.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { partnerDetailHandler } from "../../src/regulatory/routes/ops/partners";
import { readFileSync } from "fs";
import { join } from "path";

const MIGRATION_SQL = readFileSync(
  join(import.meta.dir, "../../src/regulatory/db/migrations/011_state_regulation.sql"),
  "utf-8",
);
const SEED_SQL = readFileSync(
  join(import.meta.dir, "../../src/regulatory/db/seeds/state_regulations.sql"),
  "utf-8",
);

function inMemoryDb(): Database {
  const db = new Database(":memory:");
  db.exec(MIGRATION_SQL);
  db.exec(SEED_SQL);
  return db;
}

function json(res: Response): Promise<unknown> {
  return res.json();
}

describe("partnerDetailHandler", () => {
  let db: Database;

  beforeAll(() => {
    db = inMemoryDb();
  });

  afterAll(() => db.close());

  test("returns 404 for unknown partner", async () => {
    const res = partnerDetailHandler(db, "nonexistent", {});
    expect(res.status).toBe(404);
    const body = (await json(res)) as { error: string };
    expect(body.error).toContain("Partner not found");
  });

  test("returns basic partner info without state filter", async () => {
    const res = partnerDetailHandler(db, "partner-alpha", {});
    expect(res.status).toBe(200);
    const body = (await json(res)) as Record<string, unknown>;
    expect(body.nodeId).toBe("partner-alpha");
    expect(body.createdAt).toBeTruthy();
    expect(body.regulatory).toBeUndefined();
  });

  test("returns regulatory payload with state filter", async () => {
    const res = partnerDetailHandler(db, "partner-alpha", { state: "MA" });
    expect(res.status).toBe(200);
    const body = (await json(res)) as Record<string, unknown>;
    expect(body.nodeId).toBe("partner-alpha");

    const regulatory = body.regulatory as Record<string, unknown> | undefined;
    expect(regulatory).toBeTruthy();
    expect(regulatory!.state).toBe("MA");

    const license = regulatory!.license as Record<string, unknown> | null;
    expect(license).toBeTruthy();
    expect(license!.status).toBe("active");
    expect(license!.license_number).toBe("MA-2024-001");
  });

  test("returns limits when sport and market are provided", async () => {
    const res = partnerDetailHandler(db, "partner-alpha", {
      state: "MA",
      sport: "soccer",
      market: "match_winner",
    });
    expect(res.status).toBe(200);
    const body = (await json(res)) as Record<string, unknown>;
    const regulatory = body.regulatory as Record<string, unknown>;
    const limits = regulatory!.limits as Array<Record<string, unknown>>;
    expect(limits.length).toBeGreaterThanOrEqual(1);
    expect(limits[0].sport_id).toBe("soccer");
    expect(limits[0].market_id).toBe("match_winner");
    expect(limits[0].max_wager).toBe(5000);
  });

  test("returns empty limits for nonexistent sport/market combo", async () => {
    const res = partnerDetailHandler(db, "partner-alpha", {
      state: "MA",
      sport: "cricket",
      market: "match_winner",
    });
    expect(res.status).toBe(200);
    const body = (await json(res)) as Record<string, unknown>;
    const regulatory = body.regulatory as Record<string, unknown>;
    const limits = regulatory!.limits as Array<Record<string, unknown>>;
    expect(limits.length).toBe(0);
  });

  test("returns license as null for unlicensed state", async () => {
    const res = partnerDetailHandler(db, "partner-alpha", { state: "CA" });
    expect(res.status).toBe(200);
    const body = (await json(res)) as Record<string, unknown>;
    const regulatory = body.regulatory as Record<string, unknown>;
    expect(regulatory!.license).toBeNull();
  });

  test("returns violations for partner-state combo", async () => {
    // Seed a violation
    db.run(
      `INSERT INTO regulatory_violations (node_id, user_id, play_id, state_code, reason, details, blocked_at)
       VALUES ('partner-alpha', 'user-1', 'p1', 'MA', 'max_wager exceeded', NULL, unixepoch())`,
    );

    const res = partnerDetailHandler(db, "partner-alpha", { state: "MA" });
    expect(res.status).toBe(200);
    const body = (await json(res)) as Record<string, unknown>;
    const regulatory = body.regulatory as Record<string, unknown>;
    const violations = regulatory!.violations as Array<Record<string, unknown>>;
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0].reason).toBe("max_wager exceeded");
    expect(violations[0].blockedAtIso).toBeTruthy();
  });

  test("limits violations to 20 most recent", async () => {
    // Insert 25 violations
    for (let i = 0; i < 25; i++) {
      db.run(
        `INSERT INTO regulatory_violations (node_id, user_id, play_id, state_code, reason, blocked_at)
         VALUES ('partner-beta', 'user-1', ?, 'NJ', 'test', unixepoch() - ?)`,
        [`p-${i}`, i],
      );
    }

    const res = partnerDetailHandler(db, "partner-beta", { state: "NJ" });
    const body = (await json(res)) as Record<string, unknown>;
    const regulatory = body.regulatory as Record<string, unknown>;
    const violations = regulatory!.violations as Array<Record<string, unknown>>;
    expect(violations.length).toBe(20);
  });

  test("returns suspended license status correctly", async () => {
    const res = partnerDetailHandler(db, "partner-beta", { state: "NJ" });
    expect(res.status).toBe(200);
    const body = (await json(res)) as Record<string, unknown>;
    const regulatory = body.regulatory as Record<string, unknown>;
    const license = regulatory!.license as Record<string, unknown> | null;
    expect(license).toBeTruthy();
    expect(license!.status).toBe("suspended");
  });

  test("state filter is case-insensitive", async () => {
    const res = partnerDetailHandler(db, "partner-alpha", { state: "ma" });
    expect(res.status).toBe(200);
    const body = (await json(res)) as Record<string, unknown>;
    const regulatory = body.regulatory as Record<string, unknown>;
    expect(regulatory!.state).toBe("MA");
  });
});
