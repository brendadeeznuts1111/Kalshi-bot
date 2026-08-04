/**
 * routes/ops/partners.ts — Ops dashboard route for regulatory status.
 *
 * GET /ops/partners/:nodeId?state=MA&sport=soccer&market=match_winner
 * Returns: license status, active limits, recent violations for the state.
 */

import { Database } from "bun:sqlite";

export interface PartnerDetailFilters {
  state?: string;
  sport?: string;
  market?: string;
}

export type PartnerDetailExtras = {
  /** Desk match_liquidity board (HQ domain concepts + KPIs). */
  deskLiquidity?: unknown;
};

export function partnerDetailHandler(
  db: Database,
  nodeId: string,
  filters: PartnerDetailFilters,
  extras: PartnerDetailExtras = {},
): Response {
  // ── Base partner info (stub — extend with real partner table if you have one) ──
  const partner = db
    .query<{ node_id: string; created_at: number }, [string]>(
      `SELECT node_id, MIN(granted_at) as created_at
       FROM partner_state_licenses WHERE node_id = ?
       GROUP BY node_id`,
    )
    .get(nodeId);

  if (!partner) {
    return new Response(JSON.stringify({ error: "Partner not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result: Record<string, unknown> = {
    nodeId: partner.node_id,
    createdAt: partner.created_at,
  };

  if (extras.deskLiquidity != null) {
    result.deskLiquidity = extras.deskLiquidity;
  }

  // ── State-scoped regulatory payload ──
  if (filters.state) {
    const state = filters.state.toUpperCase();

    const license = db
      .query<
        { state_code: string; license_number: string | null; status: string; granted_at: number },
        [string, string]
      >(
        `SELECT state_code, license_number, status, granted_at
         FROM partner_state_licenses
         WHERE node_id = ? AND state_code = ?`,
      )
      .get(nodeId, state);

    let limits: Array<Record<string, unknown>> = [];
    if (filters.sport && filters.market) {
      limits = db
        .query<
          {
            sport_id: string;
            market_id: string;
            max_wager: number | null;
            min_wager: number;
            allowed_bet_types: string;
            special_rules: string | null;
          },
          [string, string, string]
        >(
          `SELECT sport_id, market_id, max_wager, min_wager, allowed_bet_types, special_rules
           FROM regulatory_limits
           WHERE state_code = ? AND sport_id = ? AND market_id = ?
             AND effective_from <= unixepoch()
             AND (effective_to IS NULL OR effective_to > unixepoch())
           ORDER BY effective_from DESC`,
        )
        .all(state, filters.sport, filters.market) as Array<Record<string, unknown>>;
    }

    const violations = db
      .query<
        { reason: string; details: string | null; blocked_at: number },
        [string, string]
      >(
        `SELECT reason, details, blocked_at
         FROM regulatory_violations
         WHERE node_id = ? AND state_code = ?
         ORDER BY blocked_at DESC
         LIMIT 20`,
      )
      .all(nodeId, state);

    result.regulatory = {
      state,
      license: license ?? null,
      limits,
      violations: violations.map((v) => ({
        ...v,
        blockedAtIso: new Date(v.blocked_at * 1000).toISOString(),
      })),
    };
  }

  return new Response(JSON.stringify(result, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
