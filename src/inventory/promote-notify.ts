/**
 * Deduped Telegram notify for promote-report candidates.
 * Cron-safe: only fires when candidate id set gains new ids (or --force).
 */
// @see https://bun.com/docs/runtime/file-io
import { join } from 'node:path';
import { CACHE_DIR } from '../research/paths.ts';
import type { PromoteReport } from './promote-report.ts';
import { maybeNotifyInventoryTelegram, type InventoryNotifyResult } from './notify.ts';

export type PromoteNotifyState = {
  candidateIds: string[];
  sentAtMs: number;
};

export type PlanPromoteNotifyResult = {
  shouldSend: boolean;
  reason: 'force' | 'first' | 'new_ids' | 'no_candidates' | 'unchanged';
  newIds: string[];
  next: PromoteNotifyState;
};

export function defaultPromoteNotifyStatePath(): string {
  const override = Bun.env.INVENTORY_PROMOTE_NOTIFY_STATE?.trim();
  if (override) return override;
  return join(CACHE_DIR, 'inventory-promote-notify.json');
}

export function planPromoteNotify(
  candidateIds: string[],
  prev: PromoteNotifyState | null,
  options: { nowMs?: number; force?: boolean } = {}
): PlanPromoteNotifyResult {
  const nowMs = options.nowMs ?? Date.now();
  const sorted = [...new Set(candidateIds.map(s => s.trim()).filter(Boolean))].sort();
  const next: PromoteNotifyState = { candidateIds: sorted, sentAtMs: nowMs };

  if (options.force) {
    return {
      shouldSend: sorted.length > 0,
      reason: 'force',
      newIds: sorted,
      next: sorted.length > 0 ? next : (prev ?? next),
    };
  }
  if (sorted.length === 0) {
    return {
      shouldSend: false,
      reason: 'no_candidates',
      newIds: [],
      next: prev ?? next,
    };
  }
  if (!prev || prev.candidateIds.length === 0) {
    return { shouldSend: true, reason: 'first', newIds: sorted, next };
  }
  const prevSet = new Set(prev.candidateIds);
  const newIds = sorted.filter(id => !prevSet.has(id));
  if (newIds.length > 0) {
    return { shouldSend: true, reason: 'new_ids', newIds, next };
  }
  return {
    shouldSend: false,
    reason: 'unchanged',
    newIds: [],
    next: { candidateIds: sorted, sentAtMs: prev.sentAtMs },
  };
}

export async function loadPromoteNotifyState(
  path: string
): Promise<PromoteNotifyState | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    const raw = (await file.json()) as Partial<PromoteNotifyState>;
    if (!Array.isArray(raw.candidateIds)) return null;
    return {
      candidateIds: raw.candidateIds.map(String),
      sentAtMs: Number(raw.sentAtMs) || 0,
    };
  } catch {
    return null;
  }
}

export async function savePromoteNotifyState(
  path: string,
  state: PromoteNotifyState
): Promise<void> {
  await Bun.write(path, JSON.stringify(state, null, 2) + '\n');
}

export type MaybeNotifyPromoteOptions = {
  /** Force send even if candidate set unchanged (CLI --notify). */
  force?: boolean;
  statePath?: string;
  nowMs?: number;
  /**
   * Master switch for cron. When false, skip (CLI --notify still passes force).
   * Cron should pass enabled: env INVENTORY_PROMOTE_TELEGRAM=1.
   */
  enabled?: boolean;
};

export type MaybeNotifyPromoteResult = {
  plan: PlanPromoteNotifyResult;
  telegram: InventoryNotifyResult | 'skipped_disabled';
};

/**
 * Optionally Telegram a promote-report when new candidate competition ids appear.
 */
export async function maybeNotifyPromoteReport(
  report: PromoteReport,
  options: MaybeNotifyPromoteOptions = {}
): Promise<MaybeNotifyPromoteResult> {
  const enabled = options.enabled !== false;
  const force = options.force === true;
  if (!enabled && !force) {
    return {
      plan: {
        shouldSend: false,
        reason: 'no_candidates',
        newIds: [],
        next: {
          candidateIds: report.plan.candidates.map(c => c.record.id),
          sentAtMs: options.nowMs ?? Date.now(),
        },
      },
      telegram: 'skipped_disabled',
    };
  }

  const statePath = options.statePath ?? defaultPromoteNotifyStatePath();
  const prev = await loadPromoteNotifyState(statePath);
  const ids = report.plan.candidates.map(c => c.record.id);
  const plan = planPromoteNotify(ids, prev, {
    nowMs: options.nowMs,
    force,
  });

  if (!plan.shouldSend) {
    return { plan, telegram: 'skipped_empty' };
  }

  const lines = [
    report.summaryLine,
    ...report.detailLines.slice(0, 12),
    ...(plan.newIds.length > 0 && plan.reason === 'new_ids'
      ? [`new: ${plan.newIds.slice(0, 8).join(', ')}`]
      : []),
  ];

  const telegram = await maybeNotifyInventoryTelegram({
    title: 'Inventory promote candidates (dry — not applied)',
    lines,
    maxLines: 16,
  });

  if (telegram === 'sent') {
    await savePromoteNotifyState(statePath, plan.next);
  }

  return { plan, telegram };
}
