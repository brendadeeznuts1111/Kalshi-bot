/**
 * Promote unmapped inventory league labels → CompetitionRecord seeds.
 *
 * Filters junk (matchup blobs, person labels) then mints ids + plive mappings
 * for hand-edit into COMPETITIONS (or --apply source rewrite).
 */

import {
  competitionSlugFromLeague,
  inferGenderFromLeagueLabel,
  listCompetitions,
  matchLeagueKey,
  type CompetitionRecord,
} from './competitions.ts';
import { isSportId, type SportId } from './sports.ts';

/** Structural markers that signal a real competition, not a matchup/person. */
const LEAGUE_MARKERS =
  /\b(league|liga|cup|open|division|championship|series|seriya|masters|premier|tour|challenger|atp|wta|itf|ipbl|mpl|nba|nhl|mlb|ncaa|nation|world|super|pro|t20|ipl|qualify|playoff|tournament|grand|slam|setka|regional|friendl|women|men|u\d{2}|youth|indoor|summer|winter|classic|trophy|bowl|prix|formula|f1|ufc|wbc|wba|ibf|cage|cdbl|rhl|mnhl|3hl|bskt|upvl|att)\b/i;

export type JunkLeagueReason =
  | 'empty'
  | 'too_short'
  | 'person_initial'
  | 'matchup_blob'
  | 'no_structure'
  | 'unknown_sport';

export type PromoteLeagueInput = {
  sportId: string;
  leagueKey: string;
  /** Wire stream bucket (e.g. football for soccer). */
  inventoryBucket?: string;
  peakEventCount?: number;
  eventCountLive?: number;
};

export type CompetitionPromoteCandidate = {
  record: CompetitionRecord;
  source: PromoteLeagueInput;
  /** true when id already in COMPETITIONS (alias-only opportunity). */
  idExists: boolean;
  /** true when league already resolves via existing seed. */
  alreadyMapped: boolean;
};

export type CompetitionPromoteRejection = {
  source: PromoteLeagueInput;
  reason: JunkLeagueReason | 'already_mapped' | 'id_collision' | 'below_min_peak';
};

export type CompetitionPromotePlan = {
  candidates: CompetitionPromoteCandidate[];
  rejected: CompetitionPromoteRejection[];
  /** Records safe to insert (not already mapped, not id collision). */
  toInsert: CompetitionRecord[];
};

export function hasLeagueStructureMarker(league: string): boolean {
  return LEAGUE_MARKERS.test(league);
}

/**
 * Reject person names / matchup wire blobs that are not competitions.
 * Returns null when the label is promotable.
 */
export function junkLeagueReason(league: string): JunkLeagueReason | null {
  const raw = league.trim();
  if (!raw || raw === '(unknown)') return 'empty';
  if (raw.length < 3) return 'too_short';

  // "Vitaliy S" / "John D."
  if (/^[A-Za-z][A-Za-z'-]+ [A-Z]\.?$/.test(raw)) return 'person_initial';

  // Matchup blob: "Team A - Team B" / "X vs Y" without competition markers
  const matchupSep = /\s+-\s+|\s+vs\.?\s+/i;
  if (matchupSep.test(raw) && !hasLeagueStructureMarker(raw)) {
    return 'matchup_blob';
  }

  // Single short token with no structure (table-tennis person nicknames etc.)
  const tokens = raw.split(/[\s.]+/).filter(Boolean);
  if (tokens.length === 1 && raw.length < 12 && !hasLeagueStructureMarker(raw)) {
    return 'no_structure';
  }

  // Two tokens but first is a known circuit prefix (ATT. Saransk, IPBL CAGE)
  // already passes when markers fire; no extra gate.

  return null;
}

export function isPromotableLeagueLabel(league: string): boolean {
  return junkLeagueReason(league) === null;
}

export function mintCompetitionId(sportId: string, leagueKey: string): string {
  const slug = competitionSlugFromLeague(leagueKey);
  return `${sportId.trim().toLowerCase()}.${slug || 'unknown'}`;
}

export function competitionRecordFromLeague(input: PromoteLeagueInput): CompetitionRecord | null {
  if (!isSportId(input.sportId)) return null;
  const leagueKey = input.leagueKey.trim();
  if (!leagueKey) return null;
  const sportId = input.sportId as SportId;
  const bucket =
    (input.inventoryBucket?.trim().toLowerCase() || sportId) as string;
  const id = mintCompetitionId(sportId, leagueKey);
  return {
    id,
    sportId,
    displayName: leagueKey,
    aliases: [leagueKey],
    gender: inferGenderFromLeagueLabel(leagueKey),
    providerMappings: {
      plive: { inventoryBucket: bucket, leagueKey },
    },
  };
}

function existingMappedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const c of listCompetitions()) {
    const map = c.providerMappings.plive;
    if (map) {
      keys.add(`${map.inventoryBucket}\0${matchLeagueKey(map.leagueKey)}`);
    }
    for (const a of c.aliases) {
      keys.add(`${c.sportId}\0${matchLeagueKey(a)}`);
      if (map) keys.add(`${map.inventoryBucket}\0${matchLeagueKey(a)}`);
    }
  }
  return keys;
}

function existingIds(): Set<string> {
  return new Set(listCompetitions().map(c => c.id));
}

/**
 * Plan COMPETITIONS inserts from inventory (or any) league rows.
 */
export function planCompetitionPromote(
  inputs: PromoteLeagueInput[],
  options: { minPeak?: number } = {}
): CompetitionPromotePlan {
  const minPeak = options.minPeak ?? 1;
  const mapped = existingMappedKeys();
  const ids = existingIds();
  const candidates: CompetitionPromoteCandidate[] = [];
  const rejected: CompetitionPromoteRejection[] = [];
  const seenNorm = new Set<string>();

  for (const raw of inputs) {
    const sportId = raw.sportId.trim().toLowerCase();
    const leagueKey = raw.leagueKey.trim();
    const source: PromoteLeagueInput = {
      sportId,
      leagueKey,
      inventoryBucket: raw.inventoryBucket?.trim().toLowerCase() || undefined,
      peakEventCount: raw.peakEventCount,
      eventCountLive: raw.eventCountLive,
    };

    if (!isSportId(sportId)) {
      rejected.push({ source, reason: 'unknown_sport' });
      continue;
    }

    const junk = junkLeagueReason(leagueKey);
    if (junk) {
      rejected.push({ source, reason: junk });
      continue;
    }

    const peak = raw.peakEventCount ?? raw.eventCountLive ?? 1;
    if (peak < minPeak) {
      rejected.push({ source, reason: 'below_min_peak' });
      continue;
    }

    const bucket = source.inventoryBucket || sportId;
    const mapKey = `${bucket}\0${matchLeagueKey(leagueKey)}`;
    const dedupeKey = `${sportId}\0${matchLeagueKey(leagueKey)}`;
    if (seenNorm.has(dedupeKey)) continue;
    seenNorm.add(dedupeKey);

    if (mapped.has(mapKey) || mapped.has(dedupeKey)) {
      rejected.push({ source, reason: 'already_mapped' });
      continue;
    }

    const record = competitionRecordFromLeague(source);
    if (!record) {
      rejected.push({ source, reason: 'unknown_sport' });
      continue;
    }

    // Same slug as an existing seed (e.g. ATT. Togliatti → tennis.att_togliatti)
    // — treat as already mapped once matchLeagueKey aligns aliases.
    const idExists = ids.has(record.id);
    if (idExists) {
      rejected.push({ source, reason: 'already_mapped' });
      continue;
    }

    candidates.push({
      record,
      source,
      idExists: false,
      alreadyMapped: false,
    });
  }

  return {
    candidates,
    rejected,
    toInsert: candidates.map(c => c.record),
  };
}

/** Format one CompetitionRecord as TypeScript object literal (competitions.ts style). */
export function formatCompetitionRecordSource(rec: CompetitionRecord): string {
  const plive = rec.providerMappings.plive;
  const pandora = rec.providerMappings.pandora;
  const bucket = plive?.inventoryBucket ?? rec.sportId;
  const leagueKey = plive?.leagueKey ?? rec.displayName;
  const aliases = rec.aliases.map(a => JSON.stringify(a)).join(', ');
  const compact =
    rec.aliases.length === 1 &&
    rec.aliases[0] === leagueKey &&
    rec.gender === 'unknown' &&
    !pandora;

  const pliveLit = `{ inventoryBucket: ${JSON.stringify(bucket)}, leagueKey: ${JSON.stringify(leagueKey)} }`;
  const pandoraLit = pandora
    ? `pandora: { leagueId: ${JSON.stringify(pandora.leagueId)}, feedSportId: ${JSON.stringify(pandora.feedSportId)} }`
    : null;

  if (compact) {
    return `  {
    id: ${JSON.stringify(rec.id)},
    sportId: ${JSON.stringify(rec.sportId)},
    displayName: ${JSON.stringify(rec.displayName)},
    aliases: [${aliases}],
    gender: ${JSON.stringify(rec.gender)},
    providerMappings: { plive: ${pliveLit} },
  }`;
  }

  const mappingLines = [`      plive: ${pliveLit},`];
  if (pandoraLit) mappingLines.push(`      ${pandoraLit},`);

  return `  {
    id: ${JSON.stringify(rec.id)},
    sportId: ${JSON.stringify(rec.sportId)},
    displayName: ${JSON.stringify(rec.displayName)},
    aliases: [${aliases}],
    gender: ${JSON.stringify(rec.gender)},
    providerMappings: {
${mappingLines.join('\n')}
    },
  }`;
}

/**
 * Insert records into competitions.ts source before the closing `] as const`.
 * Idempotent on id (skips existing id strings in source).
 */
export function applyCompetitionRecordsToSource(
  source: string,
  records: CompetitionRecord[]
): { next: string; added: string[]; skipped: string[] } {
  const added: string[] = [];
  const skipped: string[] = [];
  const toAdd: CompetitionRecord[] = [];
  for (const r of records) {
    if (source.includes(`id: '${r.id}'`) || source.includes(`id: "${r.id}"`)) {
      skipped.push(r.id);
      continue;
    }
    toAdd.push(r);
    added.push(r.id);
  }
  if (toAdd.length === 0) {
    return { next: source, added, skipped };
  }

  const markers = [
    '] as const satisfies readonly CompetitionRecord[]',
    '] satisfies readonly CompetitionRecord[]',
  ];
  let marker = '';
  let idx = -1;
  for (const m of markers) {
    const i = source.lastIndexOf(m);
    if (i > idx) {
      idx = i;
      marker = m;
    }
  }
  if (idx < 0) {
    throw new Error(
      'competitions.ts: closing `] satisfies readonly CompetitionRecord[]` marker not found'
    );
  }

  // Ensure previous entry ends with comma
  let head = source.slice(0, idx).replace(/\s+$/, '');
  if (!head.endsWith(',')) {
    // last object may end with `}` without trailing comma
    const lastBrace = head.lastIndexOf('}');
    if (lastBrace >= 0 && head.slice(lastBrace + 1).trim() === '') {
      head = head.slice(0, lastBrace + 1) + ',';
    }
  }

  const block = toAdd.map(formatCompetitionRecordSource).join(',\n') + ',\n';
  const next = `${head}\n${block}${source.slice(idx)}`;
  return { next, added, skipped };
}
