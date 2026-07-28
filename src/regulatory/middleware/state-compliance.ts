/**
 * state-compliance.ts — Bun.serve middleware for regulatory gatekeeping.
 *
 * Wraps ComplianceRepository around every bet-placement request.
 * Blocks disallowed wagers with 403 + JSON error, logs violation,
 * and attaches stateCode + userId + parsed body to the request
 * for downstream handlers.
 *
 * CRITICAL: This middleware clones the request before calling .json()
 * so the body stream remains readable by downstream handlers.
 */

import type { Database } from "bun:sqlite";
import { ComplianceRepository, BetBlockedError } from "../lib/compliance-repo";
import { HEADER, HTTP_STATUS, CONTENT_TYPE, DEFAULT_USER_ID } from "../constants";

export interface BetRequestBody {
  wagerAmount: number;
  betType: string;
  sportId: string;
  marketId: string;
  stateCode: string;
  userId?: string;
  playId?: string;
}

/** Context attached to the Request by the compliance middleware. */
export interface ComplianceContext {
  stateCode: string;
  userId: string;
  playId: string;
  parsedBody: BetRequestBody;
}

declare module "bun" {
  interface Request {
    compliance?: ComplianceContext;
  }
}

export function requireStateCompliance(db: Database) {
  const compliance = new ComplianceRepository(db);

  return async (
    req: Request,
    next: () => Response | Promise<Response>,
  ): Promise<Response> => {
    // Only gate POST / PUT / PATCH bodies that look like bets
    const contentType = req.headers.get(HEADER.CONTENT_TYPE) ?? "";
    if (!contentType.includes(CONTENT_TYPE.JSON)) {
      return next();
    }

    // Clone request so downstream can re-read body
    const cloned = req.clone();
    let body: BetRequestBody;
    try {
      body = (await cloned.json()) as BetRequestBody;
    } catch {
      return next();
    }

    // If the body lacks betting fields, pass through
    if (
      body.wagerAmount === undefined ||
      !body.betType ||
      !body.sportId ||
      !body.marketId ||
      !body.stateCode
    ) {
      return next();
    }

    // Extract nodeId from request context (agent, header, or query)
    const nodeId =
      (req as any).nodeId ??
      req.headers.get(HEADER.X_NODE_ID) ??
      new URL(req.url).searchParams.get("node_id") ??
      null;

    if (!nodeId) {
      return new Response(
        JSON.stringify({ error: "Missing node_id in request context" }),
        { status: HTTP_STATUS.BAD_REQUEST, headers: { "Content-Type": CONTENT_TYPE.JSON } },
      );
    }

    const userId = body.userId ?? req.headers.get(HEADER.X_USER_ID) ?? DEFAULT_USER_ID;

    try {
      const result = compliance.placeBetAtomic({
        nodeId,
        userId,
        stateCode: body.stateCode,
        sportId: body.sportId,
        marketId: body.marketId,
        wagerAmount: body.wagerAmount,
        betType: body.betType,
        playId: body.playId ?? `play-${Date.now()}`,
      });

      // Attach structured context for downstream use
      (req as any).compliance = {
        stateCode: body.stateCode,
        userId,
        playId: result.playId,
        parsedBody: body,
      };
      return next();
    } catch (err) {
      if (err instanceof BetBlockedError) {
        return new Response(
          JSON.stringify({ error: err.message, ruleId: err.ruleId }),
          { status: HTTP_STATUS.FORBIDDEN, headers: { "Content-Type": CONTENT_TYPE.JSON } },
        );
      }
      throw err;
    }
  };
}
