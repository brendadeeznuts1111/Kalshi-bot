/**
 * compliance-alert — proactive compliance notifications (§106).
 * The platform is otherwise reactive (dashboard badge / commit block);
 * the weekly cron job can now PUSH a summary when something needs
 * attention: new advisories, a failing gate, or exemptions entering the
 * expiry warning window.
 *
 * Pure parts (buildComplianceAlertMessage, complianceAlertFingerprint)
 * are unit-tested; maybeSendComplianceAlert dedupes via a state file so
 * the same alert is not re-sent every week.
 */

export interface ComplianceAlertFacts {
  found: number;
  reportOk: boolean;
  expiringSoon: number;
  generatedAt: string;
}

export interface ComplianceAlertState {
  fingerprint: string;
  lastSent: string;
}

/** Stable identity of an alert: any fact change -> a new fingerprint. */
export function complianceAlertFingerprint(facts: ComplianceAlertFacts): string {
  return facts.found + "|" + String(facts.reportOk) + "|" + facts.expiringSoon;
}

/**
 * Markdown summary, or null when nothing needs attention. Each line is
 * included only when non-zero, so a clean week sends nothing.
 */
export function buildComplianceAlertMessage(facts: ComplianceAlertFacts): string | null {
  const lines: string[] = ["🔒 *Compliance alert*", "_" + facts.generatedAt.slice(0, 10) + "_", ""];
  if (facts.found > 0) lines.push("- New advisories: " + facts.found + " (config/audit-overrides.json updated — check the gate output)");
  if (!facts.reportOk) lines.push("- Gate FAIL — run `bun run licenses:gate` and review the report");
  if (facts.expiringSoon > 0) lines.push("- " + facts.expiringSoon + " exemption(s) inside the expiry warning window — re-review before the time-bomb fires");
  if (lines.length === 3) return null; // header + date + blank only
  lines.push("", "Report: research/outputs/licenses-report.md");
  return lines.join("\n");
}

/**
 * Send the alert to all Telegram subscribers when (a) there is something
 * to report and (b) the fingerprint changed since the last send (dedupe).
 * Returns a status string for the cron log.
 */
export async function maybeSendComplianceAlert(
  facts: ComplianceAlertFacts,
  opts: { enabled: boolean; statePath?: string },
): Promise<"sent" | "skipped" | "nothing-to-report" | "not-enabled" | "error"> {
  if (!opts.enabled) return "not-enabled";
  const message = buildComplianceAlertMessage(facts);
  if (!message) return "nothing-to-report";
  const fingerprint = complianceAlertFingerprint(facts);
  const statePath = opts.statePath ?? ".data/compliance-alert-state.json";
  let prev: ComplianceAlertState | null = null;
  try {
    prev = await Bun.file(statePath).json() as ComplianceAlertState;
  } catch {
    /* no previous alert */
  }
  if (prev && prev.fingerprint === fingerprint) return "skipped";
  try {
    const { listSubscribers } = await import("../telegram/subscribers.ts");
    const { sendMessage } = await import("../telegram/api.ts");
    const subs = await listSubscribers();
    if (subs.length === 0) return "skipped";
    for (const sub of subs) await sendMessage(sub.chatId, message, { parseMode: "Markdown" });
    await Bun.write(statePath, JSON.stringify({ fingerprint, lastSent: new Date().toISOString() }, null, 2) + "\n");
    return "sent";
  } catch (err) {
    console.error("[compliance-alert] send failed: " + err);
    return "error";
  }
}
