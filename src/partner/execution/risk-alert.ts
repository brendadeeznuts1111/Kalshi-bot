import type { Database } from "bun:sqlite";
import type { ApprovedAuthorization } from "../authorization/domain.ts";
import {
  asAuthorizationReceiptDedupeKey,
  enqueueAuthorizationReceipt,
} from "../authorization/outbox.ts";
import type { ExecutionRiskHealthDecision } from "./risk-health.ts";

/** Persist one partner-visible breaker receipt per distinct out/code set. */
export function enqueueExecutionRiskBreakerReceipt(
  db: Database,
  authorization: ApprovedAuthorization,
  decision: ExecutionRiskHealthDecision,
  nowMs = Date.now(),
): void {
  if (decision.healthy) return;
  const codes = [...new Set(decision.codes)].sort();
  const fingerprint = Bun.SHA256.hash(codes.join(","), "hex").slice(0, 16);
  enqueueAuthorizationReceipt(db, {
    dedupeKey: asAuthorizationReceiptDedupeKey(
      `execution:${authorization.outId}:breaker:${fingerprint}`,
    ),
    telegramChatId: authorization.telegramChatId,
    telegramTopicId: authorization.telegramTopicId,
    payload: {
      parseMode: "HTML",
      text:
        "🛑 <b>Authorized execution blocked</b>\n" +
        `Out: <code>${Bun.escapeHTML(authorization.outId)}</code>\n` +
        `Signals: <code>${Bun.escapeHTML(codes.join(","))}</code>`,
    },
  }, nowMs);
}
