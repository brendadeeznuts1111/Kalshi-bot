#!/usr/bin/env bun
// @ts-nocheck
/**
 * examples/regulatory-server.ts
 *
 * Example Bun.serve integration showing how to wire:
 *   - requireStateCompliance middleware (fetch-level gatekeeping)
 *   - partnerDetailHandler route (ops dashboard)
 *   - A sample /place-bet endpoint that uses the middleware
 *
 * Run: bun examples/regulatory-server.ts
 */

import { Database } from "bun:sqlite";
import { requireStateCompliance } from "../middleware/state-compliance";
import { partnerDetailHandler } from "../routes/ops/partners";
import { readFileSync } from "fs";
import { join } from "path";
import { databasePath } from "../config";
import { config } from "../../lib/config";

const db = new Database(databasePath);

// ── Bootstrap schema + seeds (in-memory or file) ──
const migration011 = readFileSync(
  join(import.meta.dir, "../db/migrations/011_state_regulation.sql"),
  "utf-8",
);
const migration012 = readFileSync(
  join(import.meta.dir, "../db/migrations/012_polymarket.sql"),
  "utf-8",
);
const seeds = readFileSync(
  join(import.meta.dir, "../db/seeds/state_regulations.sql"),
  "utf-8",
);
db.exec(migration011);
db.exec(migration012);
db.exec(seeds);

// ── Middleware factory ──
const gate = requireStateCompliance(db);

// ── Helper: attach nodeId from header for demo ──
function withNodeId(req: Request): Request {
  const nodeId = req.headers.get("x-node-id") ?? "partner-alpha";
  (req as any).nodeId = nodeId;
  return req;
}

// ── Routes ──
async function handlePlaceBet(req: Request): Promise<Response> {
  const body = (await req.json()) as Record<string, unknown>;
  return json({
    ok: true,
    playId: `play-${Date.now()}`,
    stateCode: (req as any).stateCode,
    wager: body.wagerAmount,
  });
}

function handlePartnerDetail(req: Request): Response {
  const url = new URL(req.url);
  const nodeId = url.pathname.split("/").pop()!;
  const filters = {
    state: url.searchParams.get("state") ?? undefined,
    sport: url.searchParams.get("sport") ?? undefined,
    market: url.searchParams.get("market") ?? undefined,
  };
  return partnerDetailHandler(db, nodeId, filters);
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

// ── Server ──
const server = Bun.serve({
  port: config.server.port,
  async fetch(req) {
    const url = new URL(req.url);

    // Ops dashboard (no compliance gate)
    if (url.pathname.startsWith("/ops/partners/")) {
      return handlePartnerDetail(req);
    }

    // Bet placement — run compliance middleware first
    if (url.pathname === "/place-bet" && req.method === "POST") {
      withNodeId(req);
      const gated = await gate(req, () => handlePlaceBet(req));
      return gated;
    }

    // Health / info
    if (url.pathname === "/") {
      return json({
        service: "regulatory-compliance-example",
        endpoints: ["POST /place-bet", "GET /ops/partners/:nodeId"],
        states: ["MA", "NJ", "NY", "PA", "IL"],
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Regulatory server listening on ${server.url}`);
