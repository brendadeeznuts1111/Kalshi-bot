#!/usr/bin/env bun
/**
 * Bake live.sportPeriod (+ optional live.countries) into domain SSOT modules.
 *
 *   bun tools/bake-sport-periods.ts
 *   bun tools/bake-sport-periods.ts -- --from=/tmp/live-sportPeriod.json
 *   bun tools/bake-sport-periods.ts -- --seconds=14
 *   bun tools/bake-sport-periods.ts -- --countries-from=/tmp/live-countries.json
 *
 * Writes:
 *   src/domain/pandora-sport-periods.ts
 *   src/domain/pandora-countries.ts (when countries captured or --countries-from)
 */
import { argValue, hasFlag } from '../src/cli/argv.ts';
import { capturePandoraDomainRooms } from '../src/partner/fantasy-ultra/widget-domain-capture.ts';



async function loadSportPeriod(): Promise<unknown> {
  const from = argValue('from');
  if (from) {
    return Bun.file(from).json();
  }
  const seconds = Math.min(Math.max(Number(argValue('seconds') ?? '14') || 14, 5), 60);
  console.error(`capturing live.sportPeriod / countries (${seconds}s)…`);
  const rooms = await capturePandoraDomainRooms({ seconds });
  if (!rooms.sportPeriod) {
    throw new Error('live.sportPeriod not received — try longer --seconds');
  }
  if (rooms.countries && !argValue('countries-from')) {
    await writeCountriesModule(rooms.countries);
  }
  return rooms.sportPeriod;
}

async function writeCountriesModule(payload: unknown): Promise<void> {
  if (!payload || typeof payload !== 'object') return;
  const names: Record<string, string> = {};
  for (const [id, raw] of Object.entries(payload as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const n = (raw as { n?: unknown }).n;
    if (typeof n === 'string' && n.trim()) names[id] = n.trim();
  }
  const today = new Date().toISOString().slice(0, 10);
  const ts = `/**
 * Baked Pandora live.countries (English names).
 * Captured ${today}. Id 0 = others.
 * Regenerate: bun tools/bake-sport-periods.ts
 */

export const PANDORA_COUNTRY_NAMES: Readonly<Record<string, string>> = ${JSON.stringify(names, null, 2)};

export function countryName(countryId: number | string): string | null {
  return PANDORA_COUNTRY_NAMES[String(countryId)] ?? null;
}

export function listPandoraCountries(): Array<{ id: string; name: string }> {
  return Object.entries(PANDORA_COUNTRY_NAMES)
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
`;
  const path = 'src/domain/pandora-countries.ts';
  await Bun.write(path, ts);
  console.error(`wrote ${path} (${Object.keys(names).length} countries)`);
}

async function main(): Promise<void> {
  const countriesFrom = argValue('countries-from');
  if (countriesFrom) {
    await writeCountriesModule(await Bun.file(countriesFrom).json());
  }

  const raw = (await loadSportPeriod()) as Record<string, unknown>;
  const en =
    raw.en && typeof raw.en === 'object'
      ? (raw.en as Record<string, unknown>)
      : raw.periods
        ? raw
        : null;
  if (!en || typeof en.periods !== 'object') {
    throw new Error('expected sportPeriod.en.periods or { periods } shape');
  }

  const periodNames =
    en.periodNames && typeof en.periodNames === 'object'
      ? (en.periodNames as Record<string, string>)
      : {};
  const periods = en.periods as Record<string, Record<string, string>>;
  const abbreviations =
    en.abbreviations && typeof en.abbreviations === 'object'
      ? (en.abbreviations as Record<string, string>)
      : {};

  const today = new Date().toISOString().slice(0, 10);
  const body = {
    capturedAt: today,
    language: 'en',
    periodUnit: periodNames,
    periods,
    abbreviations,
  };

  const ts = `/**
 * Baked Pandora live.sportPeriod (English) — period labels by feedSportId.
 *
 * Captured ${today}. Regenerate via tools/bake-sport-periods.ts from a capture.
 *
 * Segment codes are often s1…s10 even when the unit is Inning/Quarter/Game/Set.
 * Prefer periodLabelForFeedSport(feedSportId, code) over generic periodLabel.
 */

export type PandoraSportPeriodBake = {
  capturedAt: string;
  language: string;
  /** feedSportId → unit noun (Inning, Quarter, Set, Game, …) */
  periodUnit: Readonly<Record<string, string>>;
  /** feedSportId → periodCode → display label */
  periods: Readonly<Record<string, Readonly<Record<string, string>>>>;
  abbreviations: Readonly<Record<string, string>>;
};

export const PANDORA_SPORT_PERIODS: PandoraSportPeriodBake = ${JSON.stringify(body, null, 2)};

const unitByFeed = PANDORA_SPORT_PERIODS.periodUnit;
const periodsByFeed = PANDORA_SPORT_PERIODS.periods;

/** Unit noun for a feed sport (Inning, Set, Game, …) when known. */
export function periodUnitForFeedSport(
  feedSportId: number | string
): string | null {
  return unitByFeed[String(feedSportId)] ?? null;
}

/** Sport-aware period display label from the bake. */
export function bakedPeriodLabel(
  feedSportId: number | string,
  periodCode: string
): string | null {
  const code = periodCode.trim();
  if (!code) return null;
  const map = periodsByFeed[String(feedSportId)];
  if (!map) return null;
  return map[code] ?? map[\`L_\${code}\`] ?? null;
}

export function listBakedPeriodFeedSportIds(): number[] {
  return Object.keys(periodsByFeed)
    .map(Number)
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b);
}
`;

  const path = 'src/domain/pandora-sport-periods.ts';
  await Bun.write(path, ts);
  console.error(
    `wrote ${path} (${Object.keys(periods).length} sports, ${Object.keys(periodNames).length} units)`
  );
  if (hasFlag('json')) {
    console.log(JSON.stringify({ sports: Object.keys(periods).length, units: periodNames }, null, 2));
  }
}

await main();
