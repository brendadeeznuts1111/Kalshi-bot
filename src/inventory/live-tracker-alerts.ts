/**
 * Live-tracker → ops alerts (MARKET_REMOVED / OTB-ish state / event removed).
 * Pure plan + optional Telegram (via inventory notify).
 */
// @see https://bun.com/docs/runtime/file-io
import { join } from 'node:path';
import { CACHE_DIR } from '../research/paths.ts';
import type { LiveTrackerEvent } from './live-tracker.ts';
import {
  maybeNotifyInventoryTelegram,
  type InventoryNotifyResult,
} from './notify.ts';

export type LiveAlertKind =
  | 'MARKET_REMOVED'
  | 'SELECTION_REMOVED'
  | 'EVENT_REMOVED'
  | 'LINES_OFF'
  | 'EVENT_STATE';

export type LiveAlert = {
  kind: LiveAlertKind;
  eventId: string | number;
  time: string;
  detail: string;
  period?: string;
  marketType?: string;
};

export type LiveAlertPlan = {
  shouldSend: boolean;
  reason: 'force' | 'first' | 'new_keys' | 'none' | 'disabled';
  alerts: LiveAlert[];
  /** Dedup keys (kind+eventId+period+market). */
  keys: string[];
  newKeys: string[];
};

export type LiveAlertState = {
  keys: string[];
  sentAtMs: number;
};

const ALERT_TYPES = new Set([
  'MARKET_REMOVED',
  'SELECTION_REMOVED',
  'EVENT_REMOVED',
  'LINES_FLAG',
  'EVENT_STATE',
]);

export function liveAlertKey(a: LiveAlert): string {
  return [
    a.kind,
    String(a.eventId),
    a.period ?? '',
    a.marketType ?? '',
    a.detail.slice(0, 48),
  ].join('|');
}

export function eventsToLiveAlerts(
  events: LiveTrackerEvent[]
): LiveAlert[] {
  const out: LiveAlert[] = [];
  for (const e of events) {
    if (!ALERT_TYPES.has(e.eventType)) continue;
    if (e.eventType === 'LINES_FLAG') {
      // only alert when lines go off
      if (e.to === 'true' || e.to === '1') continue;
      out.push({
        kind: 'LINES_OFF',
        eventId: e.eventId,
        time: e.time,
        detail: e.detail,
        period: e.period,
        marketType: e.marketType,
      });
      continue;
    }
    if (e.eventType === 'EVENT_STATE') {
      // surface state transitions; filter noisy if detail has "0→0"
      out.push({
        kind: 'EVENT_STATE',
        eventId: e.eventId,
        time: e.time,
        detail: e.detail,
        period: e.period,
        marketType: e.marketType,
      });
      continue;
    }
    out.push({
      kind: e.eventType as LiveAlertKind,
      eventId: e.eventId,
      time: e.time,
      detail: e.detail,
      period: e.period,
      marketType: e.marketType,
    });
  }
  return out;
}

export function planLiveTrackerAlerts(
  events: LiveTrackerEvent[],
  prev: LiveAlertState | null,
  options: { force?: boolean; nowMs?: number; enabled?: boolean } = {}
): LiveAlertPlan {
  if (options.enabled === false) {
    return {
      shouldSend: false,
      reason: 'disabled',
      alerts: [],
      keys: prev?.keys ?? [],
      newKeys: [],
    };
  }
  const alerts = eventsToLiveAlerts(events);
  const keys = [...new Set(alerts.map(liveAlertKey))].sort();
  const nowMs = options.nowMs ?? Date.now();

  if (options.force) {
    return {
      shouldSend: alerts.length > 0,
      reason: 'force',
      alerts,
      keys,
      newKeys: keys,
    };
  }
  if (alerts.length === 0) {
    return {
      shouldSend: false,
      reason: 'none',
      alerts: [],
      keys: prev?.keys ?? [],
      newKeys: [],
    };
  }
  if (!prev || prev.keys.length === 0) {
    return {
      shouldSend: true,
      reason: 'first',
      alerts,
      keys,
      newKeys: keys,
    };
  }
  const prevSet = new Set(prev.keys);
  const newKeys = keys.filter(k => !prevSet.has(k));
  if (newKeys.length === 0) {
    return {
      shouldSend: false,
      reason: 'none',
      alerts,
      keys,
      newKeys: [],
    };
  }
  const newKeySet = new Set(newKeys);
  return {
    shouldSend: true,
    reason: 'new_keys',
    alerts: alerts.filter(a => newKeySet.has(liveAlertKey(a))),
    keys,
    newKeys,
  };
}

export function defaultLiveAlertStatePath(
  eventId?: string | number
): string {
  const override = Bun.env.INVENTORY_LIVE_ALERT_STATE?.trim();
  if (override) return override;
  const id = eventId != null ? String(eventId) : 'global';
  return join(CACHE_DIR, `live-tracker-alerts-${id}.json`);
}

export async function loadLiveAlertState(
  path: string
): Promise<LiveAlertState | null> {
  try {
    const f = Bun.file(path);
    if (!(await f.exists())) return null;
    const raw = (await f.json()) as Partial<LiveAlertState>;
    if (!Array.isArray(raw.keys)) return null;
    return {
      keys: raw.keys.map(String),
      sentAtMs: Number(raw.sentAtMs) || 0,
    };
  } catch {
    return null;
  }
}

export async function saveLiveAlertState(
  path: string,
  state: LiveAlertState
): Promise<void> {
  await Bun.write(path, JSON.stringify(state, null, 2) + '\n');
}

export function formatLiveAlertsTelegram(
  eventId: string | number,
  alerts: LiveAlert[]
): { title: string; lines: string[] } {
  const title = `⚠️ Live tracker alerts · event ${eventId} (${alerts.length})`;
  const lines = alerts.slice(0, 12).map(a => {
    const mkt =
      a.period || a.marketType
        ? ` ${a.period ?? ''}/${a.marketType ?? ''}`
        : '';
    return `${a.kind}${mkt}: ${a.detail}`;
  });
  return { title, lines };
}

export async function maybeNotifyLiveTrackerAlerts(input: {
  eventId: string | number;
  events: LiveTrackerEvent[];
  force?: boolean;
  statePath?: string;
  enabled?: boolean;
}): Promise<{
  plan: LiveAlertPlan;
  telegram: InventoryNotifyResult | 'not_attempted';
}> {
  const statePath =
    input.statePath ?? defaultLiveAlertStatePath(input.eventId);
  const prev = await loadLiveAlertState(statePath);
  const plan = planLiveTrackerAlerts(input.events, prev, {
    force: input.force,
    enabled: input.enabled,
  });
  if (!plan.shouldSend) {
    return { plan, telegram: 'not_attempted' };
  }
  const { title, lines } = formatLiveAlertsTelegram(
    input.eventId,
    plan.alerts
  );
  const telegram = await maybeNotifyInventoryTelegram({ title, lines });
  if (telegram === 'sent' || input.force) {
    await saveLiveAlertState(statePath, {
      keys: plan.keys,
      sentAtMs: Date.now(),
    });
  }
  return { plan, telegram };
}
