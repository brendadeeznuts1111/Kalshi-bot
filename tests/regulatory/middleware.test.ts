/**
 * tests/regulatory/middleware.test.ts
 *
 * Tests for regulatory middleware:
 *   - requireStateCompliance (state-compliance.ts)
 *   - createStateValidator (state-validator.ts)
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { requireStateCompliance } from "../../src/regulatory/middleware/state-compliance";
import { createStateValidator } from "../../src/regulatory/middleware/state-validator";
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

function makeRequest(opts: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Request {
  const url = opts.url ?? "http://localhost/place-bet";
  const method = opts.method ?? "POST";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.headers) Object.assign(headers, opts.headers);
  const body = opts.body ? JSON.stringify(opts.body) : undefined;
  return new Request(url, { method, headers, body });
}

// ─────────────────────────────────────────────────────────────────────────────
//  requireStateCompliance
// ─────────────────────────────────────────────────────────────────────────────

describe("requireStateCompliance middleware", () => {
  let db: Database;
  let gate: ReturnType<typeof requireStateCompliance>;

  beforeEach(() => {
    db = inMemoryDb();
    gate = requireStateCompliance(db);
  });

  afterEach(() => db.close());

  test("passes through non-JSON requests", async () => {
    const req = new Request("http://localhost/health", {
      method: "GET",
      headers: { "Content-Type": "text/plain" },
    });
    const next = () => new Response("ok");
    const res = await gate(req, next);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  test("passes through JSON body without bet fields", async () => {
    const req = makeRequest({ body: { foo: "bar" } });
    const next = () => new Response("ok");
    const res = await gate(req, next);
    expect(res.status).toBe(200);
  });

  test("passes through JSON body with partial bet fields", async () => {
    const req = makeRequest({ body: { wagerAmount: 100, sportId: "soccer" } });
    const next = () => new Response("ok");
    const res = await gate(req, next);
    expect(res.status).toBe(200);
  });

  test("returns 400 when nodeId is missing", async () => {
    const req = makeRequest({
      body: {
        wagerAmount: 100,
        betType: "straight",
        sportId: "soccer",
        marketId: "match_winner",
        stateCode: "MA",
      },
    });
    const next = () => new Response("ok");
    const res = await gate(req, next);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Missing node_id");
  });

  test("returns 400 when nodeId in query is missing", async () => {
    const req = makeRequest({
      url: "http://localhost/place-bet?node_id=",
      body: {
        wagerAmount: 100,
        betType: "straight",
        sportId: "soccer",
        marketId: "match_winner",
        stateCode: "MA",
      },
    });
    const next = () => new Response("ok");
    const res = await gate(req, next);
    expect(res.status).toBe(400);
  });

  test("allows compliant bet and attaches compliance context", async () => {
    const req = makeRequest({
      headers: { "x-node-id": "partner-alpha" },
      body: {
        wagerAmount: 100,
        betType: "straight",
        sportId: "soccer",
        marketId: "match_winner",
        stateCode: "MA",
        userId: "user-mw-1",
        playId: "play-mw-1",
      },
    });

    let nextCalled = false;
    const next = () => {
      nextCalled = true;
      const ctx = (req as any).compliance;
      expect(ctx).toBeTruthy();
      expect(ctx.stateCode).toBe("MA");
      expect(ctx.userId).toBe("user-mw-1");
      expect(ctx.playId).toBe("play-mw-1");
      return new Response("ok");
    };

    const res = await gate(req, next);
    expect(res.status).toBe(200);
    expect(nextCalled).toBe(true);
  });

  test("blocks bet exceeding limit with 403", async () => {
    const req = makeRequest({
      headers: { "x-node-id": "partner-alpha" },
      body: {
        wagerAmount: 6000, // exceeds MA soccer max_wager (5000)
        betType: "straight",
        sportId: "soccer",
        marketId: "match_winner",
        stateCode: "MA",
      },
    });
    const next = () => new Response("ok");
    const res = await gate(req, next);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; ruleId?: number };
    expect(body.error).toContain("exceeds max");
  });

  test("blocks unlicensed partner with 403", async () => {
    const req = makeRequest({
      headers: { "x-node-id": "unlicensed-partner" },
      body: {
        wagerAmount: 100,
        betType: "straight",
        sportId: "soccer",
        marketId: "match_winner",
        stateCode: "MA",
      },
    });
    const next = () => new Response("ok");
    const res = await gate(req, next);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("not licensed");
  });

  test("blocks self-excluded user with 403", async () => {
    // Seed a self-exclusion
    db.run(
      `INSERT INTO self_exclusions (user_id, node_id, reason, excluded_at, expires_at)
       VALUES ('self-excluded-mw', 'partner-alpha', 'problem-gambling', unixepoch(), NULL)`,
    );

    const req = makeRequest({
      headers: { "x-node-id": "partner-alpha", "x-user-id": "self-excluded-mw" },
      body: {
        wagerAmount: 100,
        betType: "straight",
        sportId: "soccer",
        marketId: "match_winner",
        stateCode: "MA",
      },
    });
    const next = () => new Response("ok");
    const res = await gate(req, next);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("self-excluded");
  });

  test("nodeId is extracted from request property when present", async () => {
    const req = makeRequest({
      body: {
        wagerAmount: 100,
        betType: "straight",
        sportId: "soccer",
        marketId: "match_winner",
        stateCode: "MA",
      },
    });
    (req as any).nodeId = "partner-alpha";

    let nextCalled = false;
    const next = () => {
      nextCalled = true;
      return new Response("ok");
    };
    const res = await gate(req, next);
    expect(res.status).toBe(200);
    expect(nextCalled).toBe(true);
  });

  test("nodeId is extracted from query parameter when present", async () => {
    const req = makeRequest({
      url: "http://localhost/place-bet?node_id=partner-alpha",
      body: {
        wagerAmount: 100,
        betType: "straight",
        sportId: "soccer",
        marketId: "match_winner",
        stateCode: "MA",
      },
    });
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
      return new Response("ok");
    };
    const res = await gate(req, next);
    expect(res.status).toBe(200);
    expect(nextCalled).toBe(true);
  });

  test("uses default userId when not provided", async () => {
    const req = makeRequest({
      headers: { "x-node-id": "partner-alpha" },
      body: {
        wagerAmount: 100,
        betType: "straight",
        sportId: "soccer",
        marketId: "match_winner",
        stateCode: "MA",
      },
    });
    const next = () => {
      const ctx = (req as any).compliance;
      expect(ctx.userId).toBe("anonymous");
      return new Response("ok");
    };
    const res = await gate(req, next);
    expect(res.status).toBe(200);
  });

  test("generates playId when not provided", async () => {
    const req = makeRequest({
      headers: { "x-node-id": "partner-alpha" },
      body: {
        wagerAmount: 100,
        betType: "straight",
        sportId: "soccer",
        marketId: "match_winner",
        stateCode: "MA",
      },
    });
    const next = () => {
      const ctx = (req as any).compliance;
      expect(ctx.playId).toBeTruthy();
      expect(ctx.playId.startsWith("play-")).toBe(true);
      return new Response("ok");
    };
    const res = await gate(req, next);
    expect(res.status).toBe(200);
  });

  test("passes through invalid JSON body", async () => {
    const req = new Request("http://localhost/place-bet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json-at-all",
    });
    const next = () => new Response("ok");
    const res = await gate(req, next);
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  createStateValidator
// ─────────────────────────────────────────────────────────────────────────────

describe("createStateValidator middleware", () => {
  test("passes through when no state code present", async () => {
    const validator = createStateValidator({ allowed: ["MA", "NJ"] });
    const req = new Request("http://localhost/place-bet");
    const next = () => new Response("ok");
    const res = await validator(req, next);
    expect(res.status).toBe(200);
  });

  test("allows valid state code in query string", async () => {
    const validator = createStateValidator({ allowed: ["MA", "NJ"] });
    const req = new Request("http://localhost/place-bet?state=MA");
    const next = () => new Response("ok");
    const res = await validator(req, next);
    expect(res.status).toBe(200);
  });

  test("allows valid state code in header", async () => {
    const validator = createStateValidator({ allowed: ["MA", "NJ"] });
    const req = new Request("http://localhost/place-bet", {
      headers: { "x-state-code": "NJ" },
    });
    const next = () => new Response("ok");
    const res = await validator(req, next);
    expect(res.status).toBe(200);
  });

  test("returns 400 for invalid state code in query", async () => {
    const validator = createStateValidator({ allowed: ["MA", "NJ"] });
    const req = new Request("http://localhost/place-bet?state=CA");
    const next = () => new Response("ok");
    const res = await validator(req, next);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid state code in header", async () => {
    const validator = createStateValidator({ allowed: ["MA", "NJ"] });
    const req = new Request("http://localhost/place-bet", {
      headers: { "x-state-code": "TX" },
    });
    const next = () => new Response("ok");
    const res = await validator(req, next);
    expect(res.status).toBe(400);
  });

  test("error response includes allowed states list", async () => {
    const validator = createStateValidator({ allowed: ["MA", "NJ"] });
    const req = new Request("http://localhost/place-bet?state=CA");
    const next = () => new Response("ok");
    const res = await validator(req, next);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; allowedStates: string[] };
    expect(body.error).toContain("CA");
    expect(body.allowedStates).toEqual(["MA", "NJ"]);
  });

  test("is case-insensitive by default", async () => {
    const validator = createStateValidator({ allowed: ["MA", "NJ"] });
    const req = new Request("http://localhost/place-bet?state=ma");
    const next = () => new Response("ok");
    const res = await validator(req, next);
    expect(res.status).toBe(200);
  });

  test("is case-sensitive when configured", async () => {
    const validator = createStateValidator({ allowed: ["MA", "NJ"], caseSensitive: true });
    const req = new Request("http://localhost/place-bet?state=ma");
    const next = () => new Response("ok");
    const res = await validator(req, next);
    expect(res.status).toBe(400);
  });

  test("query state takes precedence over header state", async () => {
    const validator = createStateValidator({ allowed: ["MA", "NJ"] });
    const req = new Request("http://localhost/place-bet?state=MA", {
      headers: { "x-state-code": "TX" },
    });
    const next = () => new Response("ok");
    const res = await validator(req, next);
    expect(res.status).toBe(200);
  });

  test("empty allowed list blocks all state codes", async () => {
    const validator = createStateValidator({ allowed: [] });
    const req = new Request("http://localhost/place-bet?state=MA");
    const next = () => new Response("ok");
    const res = await validator(req, next);
    expect(res.status).toBe(400);
  });
});
