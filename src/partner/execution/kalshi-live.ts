import type { Database } from "bun:sqlite";
import { loadKalshiCredentials } from "../../bot/kalshi-auth.ts";
import { createKalshiClient, type KalshiClient } from "../../bot/kalshi-client.ts";
import {
  asOutId,
  asPartnerCode,
  asSkinId,
  policyFromAuthorization,
} from "../authorization/domain.ts";
import { getActiveLiveTradeAuthorization } from "../authorization/sql.ts";
import { getBettingAccountById, type BettingAccountRow } from "../registry.ts";
import { parseOutMeta, resolveOutCapacity } from "../out-capacity.ts";
import { envPrefixFallbackChain } from "../toml-config.ts";
import {
  asExecutionIdempotencyKey,
  asMarketId,
  asMarketSelection,
  type AuthorizedBetResult,
  type BetRequest,
} from "./domain.ts";
import { executeAuthorizedBet } from "./executor.ts";
import {
  createKalshiBuyOrderMapper,
  createKalshiExecutionPlacer,
  executionIdempotencyKeyToUuid,
  expectedKalshiOrder,
  projectKalshiBuyOrder,
  type KalshiExecutionOrder,
  type KalshiOrderResponseSummary,
} from "./kalshi.ts";
import { createKalshiExecutionSnapshotLoader } from "./kalshi-snapshot.ts";
import type { ExecutionRiskHealthDecision } from "./risk-health.ts";
import { enqueueExecutionRiskBreakerReceipt } from "./risk-alert.ts";

export interface KalshiLiveOrderCommand {
  actorId?: string;
  partnerCode: BetRequest["partnerCode"];
  outId: BetRequest["outId"];
  skin: BetRequest["skin"];
  ticker: BetRequest["marketId"];
  outcome: KalshiExecutionOrder["side"];
  requestedStake: number;
  priceCents: number;
  idempotencyKey: BetRequest["idempotencyKey"];
}

export type KalshiLiveCommandParseResult =
  | { ok: true; command: KalshiLiveOrderCommand }
  | { ok: false; code: "INVALID_REQUEST" | "IDEMPOTENCY_REQUIRED"; reason: string };

export type KalshiLiveExecutionResult =
  | {
      ok: true;
      result: Extract<AuthorizedBetResult, { success: true }>;
      order: KalshiOrderResponseSummary | null;
    }
  | {
      ok: false;
      code:
        | "ACCOUNT_NOT_FOUND"
        | "ACCOUNT_INACTIVE"
        | "PARTNER_INACTIVE"
        | "PARTNER_MISMATCH"
        | "SKIN_INACTIVE"
        | "PROVIDER_NOT_IMPLEMENTED"
        | "PROVIDER_SESSION_UNAVAILABLE"
        | "CURRENCY_UNSUPPORTED"
        | "EXECUTION_DENIED";
      reason: string;
      execution?: Extract<AuthorizedBetResult, { success: false }>;
    };

export interface KalshiLiveExecutionDependencies {
  client?: Pick<KalshiClient, "environment" | "placeOrder" | "getBalance">;
  resolveClient?: (
    account: BettingAccountRow,
  ) =>
    | Promise<Pick<KalshiClient, "environment" | "placeOrder" | "getBalance">>
    | Pick<KalshiClient, "environment" | "placeOrder" | "getBalance">;
  isRiskHealthy: () => Promise<boolean | ExecutionRiskHealthDecision> | boolean | ExecutionRiskHealthDecision;
  now?: () => number;
  maxBookAgeMs?: number;
}

/** Parse the live-only HTTP wire shape into branded, integer-safe execution input. */
export function parseKalshiLiveOrderCommand(
  wire: unknown,
  idempotencyHeader?: string | null,
): KalshiLiveCommandParseResult {
  try {
    if (!isRecord(wire)) throw new TypeError("request body must be a JSON object");
    const partnerCodeRaw = requiredString(wire.partnerCode, "partnerCode").toUpperCase();
    if (!/^[A-Z]{3,6}$/.test(partnerCodeRaw)) {
      throw new TypeError("partnerCode must contain 3–6 uppercase ASCII letters");
    }
    const outIdRaw = requiredString(wire.outId, "outId");
    if (!new RegExp(`^out-${partnerCodeRaw}-[1-9][0-9]*$`).test(outIdRaw)) {
      throw new TypeError("outId must be canonical and belong to partnerCode");
    }
    const skinRaw = requiredString(wire.skin, "skin");
    const tickerRaw = requiredString(wire.ticker, "ticker");
    const outcome = wire.outcome === "yes" || wire.outcome === "no" ? wire.outcome : null;
    if (outcome === null) throw new TypeError("outcome must be 'yes' or 'no'");
    const requestedStake = positiveSafeInteger(wire.stakeMinorUnits, "stakeMinorUnits");
    const priceCents = positiveSafeInteger(wire.priceCents, "priceCents");
    if (priceCents > 99) throw new TypeError("priceCents must be between 1 and 99");
    if (wire.postOnly === true) {
      throw new TypeError(
        "authorized live orders consume executable top-of-book liquidity and require postOnly=false",
      );
    }

    const bodyKey = optionalString(wire.idempotencyKey);
    const headerKey = optionalString(idempotencyHeader);
    if (bodyKey && headerKey && bodyKey !== headerKey) {
      throw new TypeError("body and Idempotency-Key header must match");
    }
    const idempotencyKey = bodyKey ?? headerKey;
    if (!idempotencyKey) {
      return {
        ok: false,
        code: "IDEMPOTENCY_REQUIRED",
        reason: "Live execution requires an explicit Idempotency-Key header or idempotencyKey field",
      };
    }

    return {
      ok: true,
      command: {
        partnerCode: asPartnerCode(partnerCodeRaw),
        outId: asOutId(outIdRaw),
        skin: asSkinId(skinRaw),
        ticker: asMarketId(tickerRaw),
        outcome,
        requestedStake,
        priceCents,
        idempotencyKey: asExecutionIdempotencyKey(idempotencyKey),
      },
    };
  } catch (error) {
    return {
      ok: false,
      code: "INVALID_REQUEST",
      reason: error instanceof Error ? error.message : "invalid live order request",
    };
  }
}

/** Resolve the out/skin, gather live state, and dispatch only through executeAuthorizedBet(). */
export async function executeKalshiLiveOrder(
  db: Database,
  command: KalshiLiveOrderCommand,
  dependencies: KalshiLiveExecutionDependencies,
): Promise<KalshiLiveExecutionResult> {
  const account = getBettingAccountById(db, command.outId);
  if (account === null) {
    return { ok: false, code: "ACCOUNT_NOT_FOUND", reason: "Execution out was not found" };
  }
  if (account.status !== "active") {
    return { ok: false, code: "ACCOUNT_INACTIVE", reason: "Execution out is not active" };
  }
  const partner = db
    .query("SELECT active, profit_split AS profitSplit FROM partners WHERE id = $partnerId")
    .get({ $partnerId: account.partnerId }) as { active: number; profitSplit: number | null } | null;
  if (partner?.active !== 1) {
    return { ok: false, code: "PARTNER_INACTIVE", reason: "Partner is not active" };
  }
  let partnerSplitBps: number;
  try {
    partnerSplitBps = profitSplitToBasisPoints(partner.profitSplit);
  } catch (error) {
    return {
      ok: false,
      code: "EXECUTION_DENIED",
      reason: error instanceof Error ? error.message : "partner profit split is invalid",
    };
  }
  const accountPartnerCode = resolveAccountPartnerCode(account.id, account.partnerId, account.metaJson);
  if (accountPartnerCode !== command.partnerCode) {
    return {
      ok: false,
      code: "PARTNER_MISMATCH",
      reason: "Execution out does not belong to partnerCode",
    };
  }
  if (account.provider.toLowerCase() !== "kalshi") {
    return {
      ok: false,
      code: "PROVIDER_NOT_IMPLEMENTED",
      reason: `Authorized execution is not implemented for provider ${account.provider}`,
    };
  }
  if (account.currency.toUpperCase() !== "USD") {
    return {
      ok: false,
      code: "CURRENCY_UNSUPPORTED",
      reason: "Kalshi execution currently requires a USD out",
    };
  }
  const skin = resolveOutCapacity(account).find((candidate) => candidate.name === command.skin);
  if (!skin) {
    return { ok: false, code: "SKIN_INACTIVE", reason: "Requested skin is missing or inactive" };
  }
  const riskDecision = await dependencies.isRiskHealthy();
  const riskHealthy = typeof riskDecision === "boolean" ? riskDecision : riskDecision.healthy;
  if (!riskHealthy) {
    if (typeof riskDecision !== "boolean") {
      const riskAuthorization = getActiveLiveTradeAuthorization(db, {
        partnerCode: command.partnerCode,
        outId: command.outId,
        skin: command.skin,
        nowMs: (dependencies.now ?? Date.now)(),
      });
      if (riskAuthorization !== null) {
        enqueueExecutionRiskBreakerReceipt(db, riskAuthorization, riskDecision);
      }
    }
    return {
      ok: false,
      code: "EXECUTION_DENIED",
      reason: typeof riskDecision === "boolean"
        ? "Global authorized-execution circuit breaker is not healthy"
        : `Execution risk health denied: ${riskDecision.codes.join(",")}`,
    };
  }

  const sitePerBetMax = usdMajorToMinorUnits(skin.perBetMax, "skin per-bet maximum");
  let client: Pick<KalshiClient, "environment" | "placeOrder" | "getBalance"> | undefined;
  try {
    client = dependencies.resolveClient
      ? await dependencies.resolveClient(account)
      : dependencies.client;
  } catch (error) {
    return {
      ok: false,
      code: "PROVIDER_SESSION_UNAVAILABLE",
      reason: error instanceof Error ? error.message : "Kalshi credentials are unavailable",
    };
  }
  if (!client) {
    return {
      ok: false,
      code: "PROVIDER_SESSION_UNAVAILABLE",
      reason: "Kalshi live execution client resolver is not configured",
    };
  }
  let balancePromise: ReturnType<typeof client.getBalance> | null = null;
  const loadBalance = () => {
    balancePromise ??= client.getBalance();
    return balancePromise;
  };
  const now = dependencies.now ?? Date.now;
  const request: BetRequest = {
    ...(command.actorId ? { actorId: command.actorId } : {}),
    partnerCode: command.partnerCode,
    outId: command.outId,
    skin: command.skin,
    marketId: command.ticker,
    selection: asMarketSelection(command.outcome),
    idempotencyKey: command.idempotencyKey,
    requestedStake: command.requestedStake,
    decimalOdds: 100 / command.priceCents,
  };
  const loadSnapshot = createKalshiExecutionSnapshotLoader({
    db,
    side: command.outcome,
    now,
    maxAgeMs: dependencies.maxBookAgeMs,
    loadCurrentPolicy: (authorization) => {
      if (authorization.provider.toLowerCase() !== "kalshi") {
        throw new Error("Active authorization is not bound to Kalshi");
      }
      if (authorization.currency !== "USD") {
        throw new Error("Active authorization currency does not match the Kalshi out");
      }
      return policyFromAuthorization(authorization);
    },
    loadSitePerBetMax: () => sitePerBetMax,
    loadAvailableBalance: async () => {
      const balance = await loadBalance();
      if (balance.balanceCents === null) throw new Error("Kalshi balance is unavailable");
      return balance.balanceCents;
    },
    isProviderSessionValid: async () => (await loadBalance()).balanceCents !== null,
    isRiskHealthy: () => riskHealthy,
  });
  const result = await executeAuthorizedBet(db, request, {
    now,
    partnerSplitBps,
    loadSnapshot,
    capturePlacementExpectation: ({ effectiveStake, idempotencyKey }) => expectedKalshiOrder(
      client.environment,
      command.outId,
      projectKalshiBuyOrder({
        ticker: command.ticker,
        selection: command.outcome,
        effectiveStake,
        decimalOdds: request.decimalOdds,
        side: command.outcome,
      }),
      executionIdempotencyKeyToUuid(idempotencyKey),
    ),
    placeBet: createKalshiExecutionPlacer(
      client,
      createKalshiBuyOrderMapper(command.outcome),
    ),
  });
  if (!result.success) {
    return {
      ok: false,
      code: "EXECUTION_DENIED",
      reason: result.reason,
      execution: result,
    };
  }
  return {
    ok: true,
    result,
    order: isKalshiOrderResponseSummary(result.providerResponse)
      ? result.providerResponse
      : null,
  };
}

function profitSplitToBasisPoints(value: number | null): number {
  if (value === null) return 0;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError("partner profit split must be between 0 and 1");
  }
  const basisPoints = Math.round(value * 10_000);
  if (Math.abs(value - basisPoints / 10_000) > Number.EPSILON * 8) {
    throw new TypeError("partner profit split exceeds basis-point precision");
  }
  return basisPoints;
}

/** Resolve out-scoped Kalshi credentials with out → partner → KALSHI_ fallback. */
export function createKalshiAccountClientResolver(
  envMap: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
): (account: BettingAccountRow) => KalshiClient {
  const clients = new Map<string, { fingerprint: string; client: KalshiClient }>();
  return (account) => {
    const prefix = account.envPrefix?.trim() || canonicalKalshiOutPrefix(account.id);
    const chain = envPrefixFallbackChain(prefix, "kalshi");
    const scoped = {
      KALSHI_API_KEY_ID: firstEnv(chain, envMap, "API_KEY_ID"),
      KALSHI_ACCESS_KEY: firstEnv(chain, envMap, "ACCESS_KEY"),
      KALSHI_PRIVATE_KEY_PATH: firstEnv(chain, envMap, "PRIVATE_KEY_PATH"),
      KALSHI_PRIVATE_KEY: firstEnv(chain, envMap, "PRIVATE_KEY"),
    };
    const environment = envMap.KALSHI_ENV === "prod" ? "prod" : "demo";
    const fingerprint = new Bun.CryptoHasher("sha256")
      .update(JSON.stringify({ ...scoped, environment }))
      .digest("hex");
    const cached = clients.get(account.id);
    if (cached?.fingerprint === fingerprint) return cached.client;
    const client = createKalshiClient({
      credentials: loadKalshiCredentials(scoped),
      env: environment,
    });
    clients.set(account.id, { fingerprint, client });
    return client;
  };
}

export function isKalshiOrderResponseSummary(value: unknown): value is KalshiOrderResponseSummary {
  return (
    isRecord(value) &&
    typeof value.orderId === "string" &&
    typeof value.clientOrderId === "string" &&
    typeof value.ticker === "string" &&
    (value.outcome === "yes" || value.outcome === "no") &&
    Number.isFinite(value.fillCount) &&
    Number.isFinite(value.remainingCount) &&
    (value.state === "resting" ||
      value.state === "partially_filled" ||
      value.state === "filled" ||
      value.state === "not_filled")
  );
}

function resolveAccountPartnerCode(outId: string, partnerId: string, metaJson: string): string {
  const metaCode = parseOutMeta(metaJson).partnerCode;
  if (typeof metaCode === "string" && metaCode.trim()) return metaCode.trim().toUpperCase();
  const outMatch = /^out-([A-Z]{3,6})-[1-9][0-9]*$/i.exec(outId);
  if (outMatch) return outMatch[1]!.toUpperCase();
  return partnerId.replace(/^partner-/i, "").toUpperCase();
}

function canonicalKalshiOutPrefix(outId: string): string {
  const match = /^out-([A-Z]{3,6})-([1-9][0-9]*)$/i.exec(outId);
  return match ? `KALSHI_${match[1]!.toUpperCase()}_${match[2]}_` : "KALSHI_";
}

function firstEnv(
  chain: ReturnType<typeof envPrefixFallbackChain>,
  envMap: Record<string, string | undefined>,
  suffix: string,
): string | undefined {
  for (const step of chain) {
    const value = envMap[`${step.prefix}${suffix}`]?.trim();
    if (value) return value;
  }
  return undefined;
}

function usdMajorToMinorUnits(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be non-negative`);
  const minorUnits = Math.round(value * 100);
  if (!Number.isSafeInteger(minorUnits)) throw new RangeError(`${label} exceeds safe integer range`);
  return minorUnits;
}

function positiveSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value as number;
}

function requiredString(value: unknown, label: string): string {
  const parsed = optionalString(value);
  if (!parsed) throw new TypeError(`${label} is required`);
  return parsed;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
