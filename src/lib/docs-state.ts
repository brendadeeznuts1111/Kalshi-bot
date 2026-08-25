/**
 * docs-state.ts — shared .data/docs-*-state.json writers for the docs
 * quality gates (docs:check §38, docs:api §62, docs:integrity §63/§65/§66,
 * output:probe §64). The signal pipeline's collectDocs reads these so the
 * dashboard docs channel reflects the FULL docs-quality surface, not just
 * render health. Deeper integration (§67).
 *
 * Shape per file: { lastChecked, ok, ...gateFields }. ok = the gate's
 * fail count is 0. The pipeline maps ok -> severity ok/bad and surfaces
 * gateFields in the signal detail.
 */
import { join } from "node:path";

export type DocsGateState = {
  lastChecked: string;
  ok: boolean;
  fails: number;
  bunVersion: string;
  [k: string]: string | number | boolean;
};

/** Write a docs-gate state file under .data/. Returns the path. */
export async function writeDocsGateState(name: string, fields: Omit<DocsGateState, "lastChecked" | "bunVersion"> & { lastChecked?: string }): Promise<string> {
  const ROOT = join(import.meta.dir, "..", "..");
  const path = join(ROOT, ".data", name);
  const state: DocsGateState = {
    lastChecked: fields.lastChecked ?? new Date().toISOString(),
    ok: Boolean(fields.ok),
    fails: Number(fields.fails),
    bunVersion: Bun.version,
  };
  const extra = state as Record<string, string | number | boolean>;
  for (const [k, v] of Object.entries(fields)) {
    if (k !== "lastChecked" && k !== "ok" && k !== "fails" && k !== "bunVersion") extra[k] = v;
  }
  await Bun.write(path, JSON.stringify(state, null, 2) + "\n");
  return path;
}