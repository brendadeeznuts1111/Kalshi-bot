/**
 * Competition geo + kind meta (optional on {@link CompetitionRecord}).
 *
 * Legacy seeds omit fields; callers use {@link resolveCompetitionMeta} so
 * inference fills gaps without rewriting the full COMPETITIONS array.
 *
 * Label classifiers shared with promote junk filter (no circular import).
 *
 * @see docs/VOLLEYBALL-TIERS.md (sport desk tiers are separate)
 */

import {
  getCompetition,
  type CompetitionKind,
  type CompetitionRecord,
} from './competitions.ts';

/** Desk/feed shape of a competition label (re-export list for callers). */
export const COMPETITION_KINDS = [
  'league',
  'cup',
  'tournament',
  'country_bucket',
  'itf_week',
  'friendly',
  'circuit',
  'product',
  'unknown',
] as const satisfies readonly CompetitionKind[];

/**
 * ITF / satellite weekly wire labels: "W35 Aldershot - 9 August 26".
 * Contain " - " but are tournaments, not team matchups.
 */
export const ITF_WEEKLY_LABEL =
  /^(?:W|M)\d{2,3}\b.+\s+-\s+\d{1,2}\s+[A-Za-z]+\s+\d{2,4}\s*$/i;

/**
 * Single-token feed country buckets (often RU translit).
 * Keep tight — do not add person nicknames.
 */
export const FEED_COUNTRY_BUCKETS = new Set(
  [
    'indiya',
    'india',
    'rossiya',
    'belarusy',
    'niderlandi',
    'filippini',
    'polsha',
    'polysha',
    'ukraina',
    'kazakhstan',
    'germaniya',
    'frantsiya',
    'turtsiya',
    'ispaniya',
    'italiya',
    'kitay',
    'yaponiya',
    'braziliya',
  ].map(s => s.toLowerCase()),
);

export function isFeedCountryBucket(league: string): boolean {
  return FEED_COUNTRY_BUCKETS.has(league.trim().toLowerCase());
}

export function isItfWeeklyLabel(league: string): boolean {
  return ITF_WEEKLY_LABEL.test(league.trim());
}

/**
 * Resolved meta for a competition (explicit record fields win over inference).
 * `countryCode`: ISO 3166-1 alpha-2, or `INT` for multi-nation / international.
 */
export type CompetitionMeta = {
  countryCode: string | null;
  kind: CompetitionKind;
  /** True when country/kind came from inference, not stored fields. */
  inferred: boolean;
};

/** RU translit / English country bucket → ISO2. */
const COUNTRY_BUCKET_ISO: Readonly<Record<string, string>> = {
  indiya: 'IN',
  india: 'IN',
  rossiya: 'RU',
  belarusy: 'BY',
  niderlandi: 'NL',
  filippini: 'PH',
  polsha: 'PL',
  polysha: 'PL',
  ukraina: 'UA',
  kazakhstan: 'KZ',
  germaniya: 'DE',
  frantsiya: 'FR',
  turtsiya: 'TR',
  ispaniya: 'ES',
  italiya: 'IT',
  kitay: 'CN',
  yaponiya: 'JP',
  braziliya: 'BR',
  usa: 'US',
  'united states': 'US',
  england: 'GB',
  uk: 'GB',
  mexico: 'MX',
  argentina: 'AR',
  vietnam: 'VN',
  israel: 'IL',
  korea: 'KR',
  'south korea': 'KR',
  ghana: 'GH',
  angola: 'AO',
  'south africa': 'ZA',
  japan: 'JP',
  china: 'CN',
  russia: 'RU',
  belarus: 'BY',
  netherlands: 'NL',
  philippines: 'PH',
  poland: 'PL',
  ukraine: 'UA',
  germany: 'DE',
  france: 'FR',
  turkey: 'TR',
  spain: 'ES',
  italy: 'IT',
  brazil: 'BR',
};

/**
 * Leading "Country. …" / "Country …" patterns common on plive league keys.
 * Prefer longer multi-word keys first via sorted lookup.
 */
const LEADING_COUNTRY_PATTERNS: Array<{ re: RegExp; code: string }> = [
  { re: /^united states\b/i, code: 'US' },
  { re: /^south africa\b/i, code: 'ZA' },
  { re: /^south korea\b/i, code: 'KR' },
  { re: /^costa rica\b/i, code: 'CR' },
  { re: /^new zealand\b/i, code: 'NZ' },
  { re: /^hong kong\b/i, code: 'HK' },
  { re: /^saudi arabia\b/i, code: 'SA' },
  { re: /^india\b/i, code: 'IN' },
  { re: /^mexico\b/i, code: 'MX' },
  { re: /^russia\b/i, code: 'RU' },
  { re: /^belarus\b/i, code: 'BY' },
  { re: /^poland\b/i, code: 'PL' },
  { re: /^italy\b/i, code: 'IT' },
  { re: /^germany\b/i, code: 'DE' },
  { re: /^france\b/i, code: 'FR' },
  { re: /^spain\b/i, code: 'ES' },
  { re: /^brazil\b/i, code: 'BR' },
  { re: /^japan\b/i, code: 'JP' },
  { re: /^china\b/i, code: 'CN' },
  { re: /^turkey\b/i, code: 'TR' },
  { re: /^england\b/i, code: 'GB' },
  { re: /^ukraine\b/i, code: 'UA' },
  { re: /^kazakhstan\b/i, code: 'KZ' },
  { re: /^vietnam\b/i, code: 'VN' },
  { re: /^israel\b/i, code: 'IL' },
  { re: /^argentina\b/i, code: 'AR' },
  { re: /^angola\b/i, code: 'AO' },
  { re: /^ghana\b/i, code: 'GH' },
  { re: /^malaysia\b/i, code: 'MY' },
  { re: /^netherlands\b/i, code: 'NL' },
  { re: /^philippines\b/i, code: 'PH' },
];

const INT_MARKERS =
  /\b(international|world\s*cup|world\s*championship|olympics?|nations\s*league|\bvnl\b|cev\b|fivb|uefa|fifa|atp|wta|challenger\s+cup|champions\s*league|friendly\s*international|club\s*friendl)/i;

const NCAA_MARKERS = /\bncaa\b|\bcollege\b|\bncaaw\b|\bncaab\b|\bncaaf\b/i;

/**
 * Infer ISO2 country (or INT) from a feed league label.
 * Returns null when unknown.
 */
export function inferCompetitionCountryCode(leagueKey: string): string | null {
  const raw = leagueKey.trim();
  if (!raw) return null;
  const low = raw.toLowerCase();

  if (isFeedCountryBucket(raw)) {
    return COUNTRY_BUCKET_ISO[low] ?? null;
  }

  if (NCAA_MARKERS.test(low) || /\bunited states ncaa\b/i.test(low)) {
    return 'US';
  }

  if (INT_MARKERS.test(low) && !/^india\b/i.test(low) && !/^mexico\b/i.test(low)) {
    // "International …" / VNL / Olympics — multi-nation
    if (
      /\binternational\b|\bnations\s*league|\bolympics?|\bworld\s*cup|\bworld\s*championship|\bcev\b|\bfivb\b|\bclub\s*friendl/i.test(
        low,
      )
    ) {
      return 'INT';
    }
  }

  // "Country. Rest" or "Country Rest"
  for (const { re, code } of LEADING_COUNTRY_PATTERNS) {
    if (re.test(raw)) return code;
  }

  // ", Country" / "City, Country" ITF-style trailing
  const trailing = raw.match(/,\s*([A-Za-z][A-Za-z\s]+?)\s*(?:Men|Women|Singles|Doubles)?\s*$/i);
  if (trailing?.[1]) {
    const t = trailing[1].trim().toLowerCase();
    for (const { re, code } of LEADING_COUNTRY_PATTERNS) {
      // re is ^anchored — strip ^ for trailing match
      const body = re.source.replace(/^\^/, '').replace(/\\b$/i, '');
      if (new RegExp(`^${body}$`, 'i').test(t)) return code;
    }
    if (COUNTRY_BUCKET_ISO[t]) return COUNTRY_BUCKET_ISO[t]!;
  }

  // ITF weekly: "W35 Aldershot - 9 August 26" — country often not in label
  if (isItfWeeklyLabel(raw)) return null;

  return null;
}

/**
 * Infer competition kind from league label (+ optional sport for context).
 */
export function inferCompetitionKind(
  leagueKey: string,
  _sportId?: string,
): CompetitionKind {
  const raw = leagueKey.trim();
  if (!raw) return 'unknown';
  const low = raw.toLowerCase();

  if (isFeedCountryBucket(raw)) return 'country_bucket';
  if (isItfWeeklyLabel(raw)) return 'itf_week';

  if (/friend|friendl/.test(low)) return 'friendly';
  if (NCAA_MARKERS.test(low)) {
    if (/tournament|championship|final\s*four/.test(low)) return 'tournament';
    return 'league';
  }
  if (/\b(atp|wta|itf|challenger|att\.?|ipbl|setka|masters)\b/i.test(low)) {
    if (/\bcup\b|\btrophy\b/.test(low)) return 'cup';
    if (/\bopen\b|\btournament\b|\bchampionship\b/.test(low)) return 'tournament';
    return 'circuit';
  }
  if (/\bcup\b|\btrophy\b|\bsuper\s*cup\b/.test(low)) return 'cup';
  if (
    /\btournament\b|\bopen\b|\bchampionship\b|\bnations\s*league|\bolympics?|\bworld\s*cup|\bfinals?\b/i.test(
      low,
    )
  ) {
    return 'tournament';
  }
  if (/\bleague\b|\bliga\b|\bdivision\b|\bpremier\b|\bserie\b|\bv-?league\b/i.test(low)) {
    return 'league';
  }
  if (/frostball|subhockey|cage\b|blast\s*hockey/i.test(low)) return 'product';

  return 'unknown';
}

/** ISO2 or INT validation (loose). */
export function isCompetitionCountryCode(value: string): boolean {
  const v = value.trim().toUpperCase();
  if (v === 'INT') return true;
  return /^[A-Z]{2}$/.test(v);
}

export function isCompetitionKind(value: string): value is CompetitionKind {
  return (COMPETITION_KINDS as readonly string[]).includes(value);
}

/**
 * Effective meta for a record: explicit fields override inference from
 * displayName / plive leagueKey.
 */
export function resolveCompetitionMeta(
  rec: Pick<
    CompetitionRecord,
    'displayName' | 'countryCode' | 'kind' | 'providerMappings' | 'sportId'
  >,
): CompetitionMeta {
  const label =
    rec.providerMappings.plive?.leagueKey?.trim() ||
    rec.displayName?.trim() ||
    '';
  const inferredCountry = inferCompetitionCountryCode(label);
  const inferredKind = inferCompetitionKind(label, rec.sportId);

  const countryCode =
    rec.countryCode !== undefined ? rec.countryCode : inferredCountry;
  const kind = rec.kind !== undefined ? rec.kind : inferredKind;
  const inferred =
    (rec.countryCode === undefined && inferredCountry != null) ||
    (rec.kind === undefined && inferredKind !== 'unknown') ||
    (rec.countryCode === undefined && rec.kind === undefined);

  return {
    countryCode: countryCode ?? null,
    kind,
    inferred:
      rec.countryCode === undefined || rec.kind === undefined
        ? true
        : false,
  };
}

/**
 * Fill missing countryCode/kind on a record from inference (for promote writes).
 * Does not overwrite explicit values. Always sets kind (may be `unknown`).
 */
export function enrichCompetitionRecordMeta(
  rec: CompetitionRecord,
): CompetitionRecord {
  const label =
    rec.providerMappings.plive?.leagueKey?.trim() || rec.displayName.trim();
  const countryCode =
    rec.countryCode !== undefined
      ? rec.countryCode
      : inferCompetitionCountryCode(label);
  const kind =
    rec.kind !== undefined ? rec.kind : inferCompetitionKind(label, rec.sportId);

  const next: CompetitionRecord = { ...rec, kind };
  if (countryCode != null) next.countryCode = countryCode;
  else if (rec.countryCode !== undefined) next.countryCode = rec.countryCode;
  return next;
}

/** Effective meta for a competition id (registry lookup + inference). */
export function getCompetitionMetaById(id: string): CompetitionMeta | null {
  const rec = getCompetition(id);
  if (!rec) return null;
  return resolveCompetitionMeta(rec);
}
