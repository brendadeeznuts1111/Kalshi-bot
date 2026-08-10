/**
 * Extract provider domain labels from plive shell HTML + Pandora rooms.
 *
 * Static (HTML LANGUAGES.texts): MARKET_* display strings, rules sport icons.
 * Dynamic (Pandora binary rooms): live.sports, live.leagues, live.wagerTypes.
 *
 * Leagues/tiers are **not** fully listed in HTML — capture via Pandora.
 * Never logs gsid / Diffusion credentials. Writes only research cache artifacts.
 */
// @see https://bun.com/docs/api/fetch
import { listSports, type SportId } from './sports.ts';
import { PLIVE_STREAM_ENDPOINTS } from './live-product-endpoints.ts';
import {
  feedSportName,
  sportIdFromFeedSportId,
} from './pandora-feed-sports.ts';
import { CACHE_DIR, joinPath } from '../research/paths.ts';

export type WidgetMarketLabel = {
  /** MARKET_* key without prefix, e.g. SPREAD */
  id: string;
  key: string;
  displayName: string;
};

export type WidgetShellSport = {
  /** Icon slug from rules (e.g. table-tennis, soccer). */
  icon: string;
  /** Best-effort title from adjacent rules copy. */
  title: string | null;
  /** Mapped SportId when known. */
  sportId: SportId | null;
};

export type WidgetLiveSport = {
  id: string;
  name: string;
  order?: number;
  /** Market-type flags from feed (`m` map). */
  marketFlags?: Record<string, unknown>;
  /** Canonical SportId from feed id SSOT when known. */
  sportIdCanonical?: SportId | null;
};

export type WidgetLiveLeague = {
  id: string;
  name: string;
  shortName?: string | null;
  /**
   * Display/variant feed sport id from wire `s`
   * (often more specific than platformSport — e.g. 102 college BB).
   */
  sportId: string | null;
  /**
   * Parent/platform feed sport from wire `platformSport`
   * (e.g. Top Soccer 220, or base basketball 2).
   */
  platformSport?: string | null;
  /** Best-effort SportId from feed SSOT (`s` then platformSport). */
  sportIdCanonical?: SportId | null;
  order?: number;
};

export type WidgetWagerType = {
  id: string;
  name: string;
  shortName?: string | null;
  /** Market class / type ids when present. */
  marketClassId?: number | null;
  /**
   * Wire `tp` — market *family* id (often aligns with coefficient marketType
   * for core markets 3/4/5/6/30, but props reuse numbers for many named products).
   */
  typeId?: number | null;
};

/**
 * Parsed `live.sportPeriod` (or HTTP sportPeriods) language block.
 * Shape from mainapp sportPeriodsService.init:
 * `{ en: { periods: { [feedSportId]: { m: "Match", h1: "1st Half", … } }, abbreviations?: … } }`
 */
export type SportPeriodLanguageBlock = {
  language: string;
  /** feedSportId → periodCode → display label */
  bySport: Record<string, Record<string, string>>;
  abbreviations?: Record<string, string>;
};

export type WidgetSportPeriods = {
  languages: SportPeriodLanguageBlock[];
  /** Prefer `en` when present. */
  primary: SportPeriodLanguageBlock | null;
};

export type DomainGapReport = {
  domainSportIds: string[];
  shellIconsUnmapped: string[];
  liveSportsUnmapped: string[];
  domainMissingFromLive: string[];
  marketKeysNewVsKnown: string[];
  liveSportCount: number;
  liveLeagueCount: number;
  marketLabelCount: number;
  wagerTypeCount: number;
};

export type WidgetDomainSnapshot = {
  at: string;
  sources: {
    shellHtml: boolean;
    pandora: boolean;
    languageKey: string | null;
  };
  partner: {
    partnerId: string | null;
    partnerName: string | null;
  };
  markets: WidgetMarketLabel[];
  shellSports: WidgetShellSport[];
  liveSports: WidgetLiveSport[];
  liveLeagues: WidgetLiveLeague[];
  wagerTypes: WidgetWagerType[];
  /** Optional live.sportPeriod decode when captured. */
  sportPeriods?: WidgetSportPeriods | null;
  gaps: DomainGapReport;
};

export type ExtractWidgetDomainOptions = {
  /** Preloaded HTML (tests / offline). */
  html?: string;
  /** Fetch live shell when html omitted (default true). */
  fetchShell?: boolean;
  shellUrl?: string;
  languageKey?: string;
  /**
   * Injected Pandora room payloads (from capture or tests).
   * When omitted, live sports/leagues/wagers stay empty — use partner capture helper.
   */
  pandoraRooms?: {
    sports?: unknown;
    leagues?: unknown;
    wagerTypes?: unknown;
    /** live.sportPeriod payload */
    sportPeriod?: unknown;
  };
  fetchImpl?: typeof fetch;
};

const ICON_TO_SPORT_ID: Record<string, SportId> = {
  soccer: 'soccer',
  football: 'american_football',
  'american-football': 'american_football',
  baseball: 'baseball',
  basketball: 'basketball',
  tennis: 'tennis',
  'table-tennis': 'table_tennis',
  hockey: 'ice_hockey',
  'ice-hockey': 'ice_hockey',
  volleyball: 'volleyball',
  'beach-volleyball': 'volleyball',
  handball: 'handball',
  cricket: 'cricket',
  snooker: 'snooker',
  golf: 'golf',
  cycling: 'cycling',
  boxing: 'boxing',
  rugby: 'rugby',
  futsal: 'futsal',
  darts: 'darts',
  bandy: 'bandy',
  floorball: 'floorball',
  'horse-racing': 'horse_racing',
  'australian-rules': 'australian_rules',
  badminton: 'badminton',
  'motor-racing': 'motorsport',
  motorsport: 'motorsport',
  ufc: 'ufc',
  'martial-arts': 'martial_arts',
  'e-sports': 'sports_channels',
  chess: 'sports_channels',
  curling: 'sports_channels',
  lacrosse: 'sports_channels',
  'water-polo': 'sports_channels',
};

/** Known Pandora marketType ids we already label in domain. */
/** Proven coefficient marketType ids (see KNOWN_MARKET_LABELS). */
const KNOWN_MARKET_TYPE_IDS = new Set([
  '1',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '16',
  '18',
  '20',
  '21',
  '30',
]);

export function defaultWidgetDomainCachePath(): string {
  return joinPath(CACHE_DIR, 'widget-domain-snapshot.json');
}

/** Balanced `{…}` extractor starting at first `{` after marker. */
export function extractBalancedObject(
  src: string,
  marker: string,
  from = 0
): { text: string; end: number } | null {
  const i = src.indexOf(marker, from);
  if (i < 0) return null;
  const start = src.indexOf('{', i);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let quote = '';
  for (let j = start; j < src.length; j++) {
    const c = src[j]!;
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === '\\') {
        esc = true;
        continue;
      }
      if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return { text: src.slice(start, j + 1), end: j + 1 };
    }
  }
  return null;
}

export function extractAngularConstantValue(
  script: string,
  name: string
): string | null {
  const re = new RegExp(
    String.raw`\.constant\(\s*['"]${name}['"]\s*,\s*`
  );
  const m = re.exec(script);
  if (!m || m.index == null) return null;
  const start = m.index + m[0].length;
  const rest = script.slice(start).trimStart();
  if (rest.startsWith("'") || rest.startsWith('"')) {
    const q = rest[0]!;
    let out = '';
    for (let i = 1; i < rest.length; i++) {
      const c = rest[i]!;
      if (c === '\\') {
        out += rest[i + 1] ?? '';
        i++;
        continue;
      }
      if (c === q) return out;
      out += c;
    }
    return null;
  }
  return null;
}

/** Pull the inline script body that declares LANGUAGES. */
export function findLanguagesScript(html: string): string | null {
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const s of scripts) {
    const body = s[1] ?? '';
    if (body.includes("constant('LANGUAGES'") || body.includes('constant("LANGUAGES"')) {
      return body;
    }
  }
  // Fallback: whole document
  if (html.includes('LANGUAGES')) return html;
  return null;
}

/**
 * Extract English (or preferred) `texts` JSON object from LANGUAGES constant.
 * Wire embeds valid double-quoted JSON for `texts:`.
 */
export function extractLanguageTexts(
  script: string,
  languageKey = 'en'
): Record<string, string> | null {
  const keyNeedle = `key: '${languageKey}'`;
  const keyNeedle2 = `key: "${languageKey}"`;
  let from = script.indexOf(keyNeedle);
  if (from < 0) from = script.indexOf(keyNeedle2);
  if (from < 0) {
    // first texts: after LANGUAGES
    from = script.indexOf("constant('LANGUAGES'");
    if (from < 0) from = script.indexOf('constant("LANGUAGES"');
    if (from < 0) from = 0;
  }
  const obj = extractBalancedObject(script, 'texts:', from);
  if (!obj) return null;
  try {
    return JSON.parse(obj.text) as Record<string, string>;
  } catch {
    return null;
  }
}

export function extractMarketLabelsFromTexts(
  texts: Record<string, string>
): WidgetMarketLabel[] {
  const out: WidgetMarketLabel[] = [];
  for (const [key, displayName] of Object.entries(texts)) {
    if (!key.startsWith('MARKET_')) continue;
    if (typeof displayName !== 'string') continue;
    out.push({
      id: key.slice('MARKET_'.length),
      key,
      displayName,
    });
  }
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

/** Unique rules icons (+ optional title when paired nearby). */
export function extractShellSportsFromScript(script: string): WidgetShellSport[] {
  const icons = [
    ...script.matchAll(/"icon"\s*:\s*"([^"]+)"/g),
  ].map(m => m[1]!.trim().toLowerCase());
  const unique = [...new Set(icons)].filter(Boolean);
  // titles after By Sport section — best-effort: title strings that match icon slug
  const titles = [
    ...script.matchAll(/"title"\s*:\s*"([^"]+)"/g),
  ].map(m => m[1]!.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16))
  ));
  const titleByNorm = new Map<string, string>();
  for (const t of titles) {
    const n = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (n) titleByNorm.set(n, t);
  }
  return unique.map(icon => {
    const title =
      titleByNorm.get(icon) ??
      titleByNorm.get(icon.replace(/-/g, '')) ??
      null;
    return {
      icon,
      title,
      sportId: ICON_TO_SPORT_ID[icon] ?? null,
    };
  });
}

export function parseLiveSportsRoom(payload: unknown): WidgetLiveSport[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const out: WidgetLiveSport[] = [];
  for (const [id, raw] of Object.entries(payload as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.n === 'string' ? r.n.trim() : '';
    if (!name) continue;
    out.push({
      id,
      name,
      order: typeof r.o === 'number' ? r.o : undefined,
      marketFlags:
        r.m && typeof r.m === 'object' && !Array.isArray(r.m)
          ? (r.m as Record<string, unknown>)
          : undefined,
      sportIdCanonical: sportIdFromFeedSportId(id) ?? mapLiveSportNameToSportId(name),
    });
  }
  out.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
  return out;
}

/**
 * Prefer display feed id `s`, then `platformSport`, for SportId resolution.
 * Example: MLS has s=5 (Soccer) + platformSport=220 (Top Soccer).
 */
export function resolveLeagueFeedSportId(league: {
  sportId?: string | null;
  platformSport?: string | null;
}): string | null {
  return league.sportId ?? league.platformSport ?? null;
}

export function parseLiveLeaguesRoom(payload: unknown): WidgetLiveLeague[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const out: WidgetLiveLeague[] = [];
  for (const [id, raw] of Object.entries(payload as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.n === 'string' ? r.n.trim() : '';
    if (!name) continue;
    const displayFeed = r.s != null ? String(r.s) : null;
    const platform =
      r.platformSport != null ? String(r.platformSport) : null;
    const feedForMap = displayFeed ?? platform;
    out.push({
      id,
      name,
      shortName: typeof r.sn === 'string' ? r.sn : null,
      sportId: displayFeed ?? platform,
      platformSport: platform,
      sportIdCanonical: feedForMap
        ? sportIdFromFeedSportId(feedForMap) ??
          (platform ? sportIdFromFeedSportId(platform) : null)
        : null,
      order: typeof r.o === 'number' ? r.o : undefined,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function parseWagerTypesRoom(payload: unknown): WidgetWagerType[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const out: WidgetWagerType[] = [];
  for (const [id, raw] of Object.entries(payload as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.n === 'string' ? r.n.trim() : '';
    if (!name) continue;
    out.push({
      id,
      name,
      shortName: typeof r.sn === 'string' ? r.sn : null,
      marketClassId: typeof r.mcId === 'number' ? r.mcId : null,
      typeId: typeof r.tp === 'number' ? r.tp : null,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Parse live.sportPeriod / sportPeriods HTTP payload.
 * Accepts either full multi-lang map or a single `{ periods: … }` block.
 */
export function parseSportPeriodRoom(payload: unknown): WidgetSportPeriods | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const root = payload as Record<string, unknown>;

  // Single-language shape: { periods: { sportId: { m: "Match", … } } }
  if (root.periods && typeof root.periods === 'object' && !Array.isArray(root.periods)) {
    const block = parseSportPeriodLanguage('en', root);
    return block
      ? { languages: [block], primary: block }
      : null;
  }

  const languages: SportPeriodLanguageBlock[] = [];
  for (const [lang, raw] of Object.entries(root)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const block = parseSportPeriodLanguage(lang, raw as Record<string, unknown>);
    if (block) languages.push(block);
  }
  if (languages.length === 0) return null;
  const primary =
    languages.find(l => l.language === 'en') ?? languages[0] ?? null;
  return { languages, primary };
}

function parseSportPeriodLanguage(
  language: string,
  raw: Record<string, unknown>
): SportPeriodLanguageBlock | null {
  const periodsRaw = raw.periods;
  if (!periodsRaw || typeof periodsRaw !== 'object' || Array.isArray(periodsRaw)) {
    return null;
  }
  const bySport: Record<string, Record<string, string>> = {};
  for (const [sportId, periodMap] of Object.entries(
    periodsRaw as Record<string, unknown>
  )) {
    if (!periodMap || typeof periodMap !== 'object' || Array.isArray(periodMap)) {
      continue;
    }
    const labels: Record<string, string> = {};
    for (const [code, label] of Object.entries(
      periodMap as Record<string, unknown>
    )) {
      if (typeof label === 'string' && label.trim()) {
        labels[code] = label.trim();
      }
    }
    if (Object.keys(labels).length > 0) bySport[sportId] = labels;
  }
  if (Object.keys(bySport).length === 0) return null;
  const abbreviations =
    raw.abbreviations &&
    typeof raw.abbreviations === 'object' &&
    !Array.isArray(raw.abbreviations)
      ? Object.fromEntries(
          Object.entries(raw.abbreviations as Record<string, unknown>).filter(
            (e): e is [string, string] => typeof e[1] === 'string'
          )
        )
      : undefined;
  return { language, bySport, abbreviations };
}

/** Period display label from sportPeriod room, else {@link periodLabel} fallback. */
export function sportPeriodLabel(
  periods: WidgetSportPeriods | null | undefined,
  feedSportId: string | number,
  periodCode: string
): string | null {
  const code = periodCode.trim();
  if (!code) return null;
  const sportKey = String(feedSportId);
  const block = periods?.primary;
  const fromFeed = block?.bySport[sportKey]?.[code];
  if (fromFeed) return fromFeed;
  // try L_ prefix (league-scoped keys in mainapp)
  const fromL = block?.bySport[sportKey]?.[`L_${code}`];
  if (fromL) return fromL;
  return null;
}

/**
 * Count wagerTypes grouped by wire `tp` (market family).
 * Useful for gap reports — typeId is not a 1:1 market product.
 */
export function wagerTypeFamilyCounts(
  wagerTypes: WidgetWagerType[]
): Array<{ typeId: number | null; count: number; sampleName: string }> {
  const map = new Map<number | null, { count: number; sampleName: string }>();
  for (const w of wagerTypes) {
    const k = w.typeId ?? null;
    const cur = map.get(k);
    if (cur) cur.count += 1;
    else map.set(k, { count: 1, sampleName: w.name });
  }
  return [...map.entries()]
    .map(([typeId, v]) => ({ typeId, count: v.count, sampleName: v.sampleName }))
    .sort((a, b) => b.count - a.count || String(a.typeId).localeCompare(String(b.typeId)));
}

function normalizeSportLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Best-effort map live sport **name** → domain SportId.
 * Prefer {@link sportIdFromFeedSportId} when you have a numeric feed id.
 *
 * Pandora feed uses "Football" = American football and "Soccer" = soccer.
 */
export function mapLiveSportNameToSportId(name: string): SportId | null {
  const n = normalizeSportLabel(name);

  // Exact feed catalog name hit (authoritative when id unknown)
  // Prefer more specific first: "american football" before generic football
  if (
    /american|am\.?\s*football|nfl|college football|college fb|cfl|super bowl|grey cup|\blfa\b/.test(
      n
    )
  ) {
    return 'american_football';
  }
  // Feed name "Football" is American football (id 3), not soccer
  if (n === 'football') return 'american_football';
  if (n === 'soccer' || /fifa|liga mx|top soccer|world cup/.test(n)) {
    return 'soccer';
  }
  if (/beach\s*volleyball/.test(n)) return 'volleyball';
  if (/college\s*basketball|nba|wnba|basketball 3x3/.test(n)) {
    return 'basketball';
  }
  if (/hockey world|iihf|world juniors/.test(n)) return 'ice_hockey';
  if (/^hockey$|^ice hockey$/.test(n)) return 'ice_hockey';
  if (/e-?sports|esport/.test(n)) return 'sports_channels';
  if (/fighting|combat sport|martial arts/.test(n)) return 'martial_arts';
  if (/^mma$|^ufc$/.test(n)) return 'ufc';
  if (/softball/.test(n)) return 'baseball';

  const aliases: Array<[RegExp, SportId]> = [
    [/^baseball$/, 'baseball'],
    [/^basketball$/, 'basketball'],
    [/^tennis$/, 'tennis'],
    [/^table tennis$/, 'table_tennis'],
    [/^volleyball$/, 'volleyball'],
    [/^handball$/, 'handball'],
    [/^cricket$/, 'cricket'],
    [/^snooker$/, 'snooker'],
    [/^golf$/, 'golf'],
    [/^cycling$|^bicycle$/, 'cycling'],
    [/^boxing$/, 'boxing'],
    [/^rugby/, 'rugby'],
    [/^futsal$/, 'futsal'],
    [/^darts$/, 'darts'],
    [/^bandy$/, 'bandy'],
    [/^floorball$/, 'floorball'],
    [/^horse racing$/, 'horse_racing'],
    [/^australian rules$|^aussie rules$/, 'australian_rules'],
    [/^badminton$/, 'badminton'],
    [/^motor|^nascar/, 'motorsport'],
    [/^formula 1$|^f1$/, 'formula_1'],
  ];
  for (const [re, id] of aliases) {
    if (re.test(n)) return id;
  }
  // Soft "other" bucket for specialty shells
  if (/politics|entertainment|simulations|olympics/.test(n)) {
    return 'sports_channels';
  }
  // Leave truly unmapped (no SportId yet)
  if (
    /curling|water\s*polo|lacrosse|chess|field hockey|kabaddi|padel|universal/.test(
      n
    )
  ) {
    return null;
  }
  for (const s of listSports()) {
    if (normalizeSportLabel(s.displayName) === n) return s.id;
  }
  return null;
}

/** Resolve SportId from feed id first, then name. */
export function resolveLiveSportId(input: {
  feedSportId?: string | number | null;
  name?: string | null;
}): SportId | null {
  if (input.feedSportId != null && String(input.feedSportId).trim() !== '') {
    const byId = sportIdFromFeedSportId(input.feedSportId);
    if (byId) return byId;
  }
  if (input.name?.trim()) return mapLiveSportNameToSportId(input.name);
  return null;
}

export function buildDomainGaps(input: {
  shellSports: WidgetShellSport[];
  liveSports: WidgetLiveSport[];
  markets: WidgetMarketLabel[];
  wagerTypes: WidgetWagerType[];
  liveLeagues: WidgetLiveLeague[];
}): DomainGapReport {
  const domain = listSports();
  const domainIds = domain.map(s => s.id);
  const shellIconsUnmapped = input.shellSports
    .filter(s => s.sportId == null)
    .map(s => s.icon)
    .sort();

  const liveSportsUnmapped = input.liveSports
    .filter(
      s =>
        (s.sportIdCanonical ??
          resolveLiveSportId({ feedSportId: s.id, name: s.name })) == null
    )
    .map(s => `${s.id}:${s.name}`)
    .sort();

  const liveMapped = new Set(
    input.liveSports
      .map(
        s =>
          s.sportIdCanonical ??
          resolveLiveSportId({ feedSportId: s.id, name: s.name })
      )
      .filter((x): x is SportId => x != null)
  );
  const domainMissingFromLive = domainIds.filter(id => !liveMapped.has(id as SportId));

  // Market keys that look like core types we might want in KNOWN_MARKET_LABELS
  const interesting = input.markets
    .filter(m =>
      /^(SPREAD|TOTAL|MONEYLINE|MONEY_LINE|DRAW_NO_BET|DOUBLE_CHANCE|TEAM_TOTAL)/.test(
        m.id
      )
    )
    .map(m => m.key);

  return {
    domainSportIds: domainIds,
    shellIconsUnmapped,
    liveSportsUnmapped,
    domainMissingFromLive,
    marketKeysNewVsKnown: interesting,
    liveSportCount: input.liveSports.length,
    liveLeagueCount: input.liveLeagues.length,
    marketLabelCount: input.markets.length,
    wagerTypeCount: input.wagerTypes.length,
  };
}

export async function fetchPliveShellHtml(
  options: {
    url?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {}
): Promise<string> {
  const url =
    options.url ??
    `${PLIVE_STREAM_ENDPOINTS.streamOrigin}${PLIVE_STREAM_ENDPOINTS.livePathPrefix}?lang=en`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), options.timeoutMs ?? 20_000);
  try {
    const res = await fetchImpl(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'kalshi-bot-domain-extract/1.0',
      },
      signal: ac.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`shell HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export async function extractWidgetDomain(
  options: ExtractWidgetDomainOptions = {}
): Promise<WidgetDomainSnapshot> {
  const languageKey = options.languageKey ?? 'en';
  let html = options.html;
  let shellHtml = false;
  if (!html && options.fetchShell !== false) {
    html = await fetchPliveShellHtml({
      url: options.shellUrl,
      fetchImpl: options.fetchImpl,
    });
    shellHtml = true;
  } else if (html) {
    shellHtml = true;
  }

  let markets: WidgetMarketLabel[] = [];
  let shellSports: WidgetShellSport[] = [];
  let partnerId: string | null = null;
  let partnerName: string | null = null;
  let langUsed: string | null = null;

  if (html) {
    const script = findLanguagesScript(html);
    if (script) {
      const texts = extractLanguageTexts(script, languageKey);
      if (texts) {
        markets = extractMarketLabelsFromTexts(texts);
        langUsed = languageKey;
      }
      shellSports = extractShellSportsFromScript(script);
      partnerId = extractAngularConstantValue(script, 'PARTNER_ID');
      partnerName = extractAngularConstantValue(script, 'PARTNER_NAME');
    }
  }

  let liveSports: WidgetLiveSport[] = [];
  let liveLeagues: WidgetLiveLeague[] = [];
  let wagerTypes: WidgetWagerType[] = [];
  let sportPeriods: WidgetSportPeriods | null = null;
  let pandoraOk = false;

  if (options.pandoraRooms) {
    liveSports = parseLiveSportsRoom(options.pandoraRooms.sports);
    liveLeagues = parseLiveLeaguesRoom(options.pandoraRooms.leagues);
    wagerTypes = parseWagerTypesRoom(options.pandoraRooms.wagerTypes);
    sportPeriods = parseSportPeriodRoom(options.pandoraRooms.sportPeriod);
    pandoraOk =
      liveSports.length > 0 ||
      liveLeagues.length > 0 ||
      wagerTypes.length > 0 ||
      sportPeriods != null;
  }

  const gaps = buildDomainGaps({
    shellSports,
    liveSports,
    markets,
    wagerTypes,
    liveLeagues,
  });

  return {
    at: new Date().toISOString(),
    sources: {
      shellHtml,
      pandora: pandoraOk,
      languageKey: langUsed,
    },
    partner: { partnerId, partnerName },
    markets,
    shellSports,
    liveSports,
    liveLeagues,
    wagerTypes,
    sportPeriods,
    gaps,
  };
}

export function formatWidgetDomainSnapshot(
  snap: WidgetDomainSnapshot,
  options: { maxLeagues?: number; maxMarkets?: number } = {}
): string {
  const maxLeagues = options.maxLeagues ?? 40;
  const maxMarkets = options.maxMarkets ?? 30;
  const lines: string[] = [];
  lines.push(`widget-domain-extract @ ${snap.at}`);
  lines.push(
    `sources: shell=${snap.sources.shellHtml} pandora=${snap.sources.pandora} lang=${snap.sources.languageKey ?? '—'}`
  );
  lines.push(
    `partner: id=${snap.partner.partnerId ?? '—'} name=${snap.partner.partnerName ?? '—'}`
  );
  lines.push(
    `counts: markets=${snap.markets.length} shellSports=${snap.shellSports.length} ` +
      `liveSports=${snap.liveSports.length} leagues=${snap.liveLeagues.length} wagerTypes=${snap.wagerTypes.length}`
  );
  lines.push('');
  lines.push('## Shell sports (rules icons)');
  for (const s of snap.shellSports) {
    lines.push(
      `  ${s.sportId ? '✓' : '?'} ${s.icon.padEnd(20)} → ${s.sportId ?? 'unmapped'} ${s.title ? `(${s.title})` : ''}`
    );
  }
  lines.push('');
  lines.push('## Live sports (Pandora)');
  for (const s of snap.liveSports) {
    const map =
      s.sportIdCanonical ??
      resolveLiveSportId({ feedSportId: s.id, name: s.name });
    const mkeys = s.marketFlags ? Object.keys(s.marketFlags).join(',') : '';
    const feedName = feedSportName(s.id);
    lines.push(
      `  ${map ? '✓' : '?'} id=${s.id.padEnd(4)} ${s.name.padEnd(22)} domain=${map ?? '—'} feed=${feedName ?? '—'} markets=[${mkeys}]`
    );
  }
  lines.push('');
  lines.push(`## Live leagues (first ${maxLeagues}/${snap.liveLeagues.length})`);
  for (const l of snap.liveLeagues.slice(0, maxLeagues)) {
    const plat =
      l.platformSport && l.platformSport !== l.sportId
        ? ` plat=${l.platformSport}`
        : '';
    const dom = l.sportIdCanonical ? ` →${l.sportIdCanonical}` : '';
    lines.push(
      `  ${l.id.padEnd(6)} s=${String(l.sportId ?? '—').padEnd(4)}${plat}${dom} ${l.name}${l.shortName ? ` [${l.shortName}]` : ''}`
    );
  }
  if (snap.liveLeagues.length > maxLeagues) {
    lines.push(`  … +${snap.liveLeagues.length - maxLeagues} more`);
  }
  lines.push('');
  lines.push(`## MARKET_* labels (sample ${maxMarkets}/${snap.markets.length})`);
  for (const m of snap.markets.slice(0, maxMarkets)) {
    lines.push(`  ${m.key.padEnd(36)} ${m.displayName}`);
  }
  if (snap.markets.length > maxMarkets) {
    lines.push(`  … +${snap.markets.length - maxMarkets} more`);
  }
  lines.push('');
  lines.push('## Gaps vs domain SPORTS');
  lines.push(
    `  shell unmapped icons: ${snap.gaps.shellIconsUnmapped.join(', ') || 'none'}`
  );
  lines.push(
    `  live sports unmapped: ${snap.gaps.liveSportsUnmapped.join(', ') || 'none'}`
  );
  lines.push(
    `  domain not seen live: ${snap.gaps.domainMissingFromLive.join(', ') || 'none'}`
  );
  lines.push(
    `  interesting MARKET_* keys: ${snap.gaps.marketKeysNewVsKnown.slice(0, 20).join(', ')}`
  );
  lines.push('');
  lines.push(
    `known Pandora marketType ids: ${[...KNOWN_MARKET_TYPE_IDS].join(', ')}`
  );
  return lines.join('\n');
}

export async function writeWidgetDomainSnapshot(
  snap: WidgetDomainSnapshot,
  path = defaultWidgetDomainCachePath()
): Promise<string> {
  await Bun.write(path, JSON.stringify(snap, null, 2));
  return path;
}
