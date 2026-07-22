// @see https://bun.com/docs/runtime/child-process#inter-process-communication-ipc
// @see https://bun.com/docs/runtime/child-process#reference
/** Structured research progress — IPC to agent parent or optional in-process callback. */

export type ResearchProgressMessage =
  | { type: "phase"; phase: "discover" | "gate" | "inspect" | "score" | "write"; dimension: string; detail?: string }
  | { type: "stats"; discovered: number; gated: number; label?: string }
  | { type: "inspect"; repo: string; n: number; total: number; cached: boolean; brief?: string }
  | { type: "complete"; runId: string; dimension: string; shortlist: number }
  | { type: "error"; message: string; exitCode?: number };

export type ResearchProgressSink = (message: ResearchProgressMessage) => void;

export function isResearchProgressMessage(value: unknown): value is ResearchProgressMessage {
  if (!value || typeof value !== "object") return false;
  const msg = value as ResearchProgressMessage;
  switch (msg.type) {
    case "phase":
      return typeof msg.dimension === "string" && typeof msg.phase === "string";
    case "stats":
      return typeof msg.discovered === "number" && typeof msg.gated === "number";
    case "inspect":
      return (
        typeof msg.repo === "string" &&
        typeof msg.n === "number" &&
        typeof msg.total === "number" &&
        typeof msg.cached === "boolean"
      );
    case "complete":
      return (
        typeof msg.runId === "string" &&
        typeof msg.dimension === "string" &&
        typeof msg.shortlist === "number"
      );
    case "error":
      return typeof msg.message === "string";
    default:
      return false;
  }
}

/** True when this process is a Bun.spawn IPC child (parent owns stderr relay). */
export function isResearchIpcChild(): boolean {
  return typeof process.send === "function";
}

export function emitResearchProgress(
  message: ResearchProgressMessage,
  sink?: ResearchProgressSink,
): void {
  sink?.(message);
  if (isResearchIpcChild()) {
    process.send!(message);
  }
}

/** Emit structured progress; mirror to stderr only when not an IPC child. */
export function logResearchProgress(
  message: ResearchProgressMessage,
  sink?: ResearchProgressSink,
): void {
  emitResearchProgress(message, sink);
  if (!isResearchIpcChild()) {
    const line = formatProgressLine(message);
    if (line) console.error(line);
  }
}

/** Human status lines for standalone CLI — suppressed under IPC spawn (parent relays). */
export function logResearchStatus(line: string): void {
  if (!isResearchIpcChild()) console.error(line);
}

export function formatProgressLine(message: ResearchProgressMessage): string | null {
  switch (message.type) {
    case "phase":
      return message.detail
        ? `[research] ${message.phase}: ${message.detail}`
        : `[research] ${message.phase} (dimension=${message.dimension})`;
    case "stats":
      return message.label
        ? `[research] discovered ${message.discovered} (${message.label}), ${message.gated} gated`
        : `[research] discovered ${message.discovered}, ${message.gated} gated`;
    case "inspect": {
      const tail = message.brief ? ` ${message.brief}` : "";
      return `  inspect ${message.repo}${message.cached ? " (cached)" : ""} (${message.n}/${message.total})${tail}`;
    }
    case "complete":
      return `[research] complete run=${message.runId} shortlist=${message.shortlist}`;
    case "error":
      return `[research] error: ${message.message}`;
    default:
      return null;
  }
}

/** argv for `Bun.spawn({ cmd: ["bun", "src/research/cli.ts", ...] })`. */
export function buildResearchSpawnArgs(options: {
  json?: boolean;
  exportAudit?: boolean;
  dimension?: string;
  shortlist?: number;
  minStars?: number;
  minForks?: number;
  maxAgeMonths?: number;
  diff?: string;
}): string[] {
  const args: string[] = [];
  if (options.json) args.push("--json");
  if (options.exportAudit) args.push("--export-audit");
  if (options.dimension) args.push(`--dimension=${options.dimension}`);
  if (options.shortlist !== undefined) args.push(`--shortlist=${options.shortlist}`);
  if (options.minStars !== undefined) args.push(`--min-stars=${options.minStars}`);
  if (options.minForks !== undefined) args.push(`--min-forks=${options.minForks}`);
  if (options.maxAgeMonths !== undefined) args.push(`--max-age-months=${options.maxAgeMonths}`);
  if (options.diff) args.push(`--diff=${options.diff}`);
  return args;
}
