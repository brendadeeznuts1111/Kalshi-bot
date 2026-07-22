// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
import { joinPath } from "../research/paths.ts";

export type PulseTick = {
  ts: string;
  ok: boolean;
  findings: number;
  concepts: number;
  errorCount: number;
  errors: string[];
  elapsedMs: number;
};

const DEFAULT_ROTOR_ROOT = joinPath(process.env.HOME ?? "", "Projects");

export function resolveRotorRoot(): string {
  const raw = Bun.env.ROTOR_ROOT?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_ROTOR_ROOT;
}

export function pulseLogPath(): string {
  return joinPath(resolveRotorRoot(), "pulse.log");
}

export async function pulseLogExists(): Promise<boolean> {
  return Bun.file(pulseLogPath()).exists();
}

export function parsePulseLine(line: string): PulseTick | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const obj = JSON.parse(trimmed) as Partial<PulseTick>;
    if (typeof obj.ts !== "string" || typeof obj.ok !== "boolean") return null;
    return {
      ts: obj.ts,
      ok: obj.ok,
      findings: Number(obj.findings ?? 0),
      concepts: Number(obj.concepts ?? 0),
      errorCount: Number(obj.errorCount ?? 0),
      errors: Array.isArray(obj.errors) ? obj.errors.map(String) : [],
      elapsedMs: Number(obj.elapsedMs ?? 0),
    };
  } catch {
    return null;
  }
}

/** Read the last N JSON lines from the rotor pulse log (newest last). */
export async function readPulseLog(limit = 20): Promise<PulseTick[]> {
  const path = pulseLogPath();
  const file = Bun.file(path);
  if (!(await file.exists())) return [];

  const text = await file.text();
  const ticks: PulseTick[] = [];
  for (const line of text.split("\n")) {
    const tick = parsePulseLine(line);
    if (tick) ticks.push(tick);
  }
  if (limit <= 0 || ticks.length <= limit) return ticks;
  return ticks.slice(-limit);
}

export async function latestPulseTick(): Promise<PulseTick | null> {
  const ticks = await readPulseLog(1);
  return ticks.at(-1) ?? null;
}
