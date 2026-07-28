/**
 * state-validator.ts — Validate state_code values against a configurable whitelist.
 *
 * Blocks requests with malformed or unauthorized state codes before they reach
 * the compliance engine. Returns 400 with a clear error.
 *
 * Usage:
 *   const validator = createStateValidator({ allowed: ["MA", "NJ"] });
 *   return validator(req, () => next());
 */

import { HTTP_STATUS, CONTENT_TYPE } from "../constants";

export interface StateValidatorOptions {
  allowed: string[];        // e.g. ["MA", "NJ"]
  caseSensitive?: boolean;  // default false
}

export function createStateValidator(options: StateValidatorOptions) {
  const { allowed, caseSensitive = false } = options;
  const normalized = caseSensitive ? allowed : allowed.map((s) => s.toUpperCase());

  return (
    req: Request,
    next: () => Response | Promise<Response>,
  ): Response | Promise<Response> => {
    // Extract state from query, header, or body (best-effort)
    const url = new URL(req.url);
    let stateCode = url.searchParams.get("state") ?? req.headers.get("x-state-code") ?? null;


    if (!stateCode) {
      // No state code present — let downstream handlers decide
      return next();
    }

    const check = caseSensitive ? stateCode : stateCode.toUpperCase();
    if (!normalized.includes(check)) {
      return new Response(
        JSON.stringify({
          error: `State code '${stateCode}' is not supported`,
          allowedStates: allowed,
        }),
        {
          status: HTTP_STATUS.BAD_REQUEST,
          headers: { "Content-Type": CONTENT_TYPE.JSON },
        },
      );
    }

    return next();
  };
}
