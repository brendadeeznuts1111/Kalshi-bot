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
import { ComplianceRepository } from "../lib/compliance-repo";
import { BetBlockedError } from "../lib/errors";
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
  executionIdempotencyKey?: string;
}

/** Live execution creates a proposal; dry runs never create regulatory plays. */
export function requireExecutionStateCompliance(db: Database) {
  const compliance = new ComplianceRepository(db);
  return async (req: Request, next: () => Response | Promise<Response>): Promise<Response> => {
    const body = await req.clone().json().catch(() => null) as Record<string, unknown> | null;
    if (!body || body.dryRun !== false) return next();
    const stateCode = stringField(body.stateCode);
    const sportId = stringField(body.sportId);
    const betType = stringField(body.betType);
    const marketId = stringField(body.ticker);
    const nodeId = stringField(body.partnerCode);
    const bodyKey = stringField(body.idempotencyKey);
    const headerKey = req.headers.get("Idempotency-Key")?.trim() || null;
    const idempotencyKey = bodyKey ?? headerKey;
    const stake = body.stakeMinorUnits;
    const principal = req.tradingPrincipal;
    if (!stateCode || !sportId || !betType || !marketId || !nodeId || !idempotencyKey ||
        !Number.isSafeInteger(stake) || (stake as number) <= 0 || !principal) {
      return Response.json({ error: "Live execution regulatory fields are incomplete" }, { status: 400 });
    }
    if (bodyKey && headerKey && bodyKey !== headerKey) {
      return Response.json({ error: "Idempotency keys do not match" }, { status: 400 });
    }
    const playId = `exec-${Bun.SHA256.hash(idempotencyKey, "hex").slice(0, 32)}`;
    try {
      compliance.proposeExecutionBetAtomic({
        nodeId, userId: principal.actorId, stateCode, sportId, marketId,
        wagerAmount: (stake as number) / 100, betType, playId, idempotencyKey,
      });
      (req as Request & { compliance?: ComplianceContext }).compliance = {
        stateCode, userId: principal.actorId, playId, executionIdempotencyKey: idempotencyKey,
        parsedBody: { wagerAmount: (stake as number) / 100, betType, sportId, marketId, stateCode },
      };
      return next();
    } catch (err) {
      if (err instanceof BetBlockedError) {
        return Response.json({ error: err.message, ruleId: err.ruleId }, { status: 403 });
      }
      throw err;
    }
  };
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
