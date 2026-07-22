/**
 * ITF World Tennis Tour primary results — Stadion sports-data feed used by
 * https://www.itftennis.com/en/world-tennis-tour-live/
 *
 * Facts from this feed are assembled independently (not a third-party CSV
 * compilation). Every ingested row carries provenance + corpus=trading.
 *
 * @see docs/TENNIS_PROGRAM_ARCHETYPES.md
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { sha3Hex } from "../evidence-chain.ts";
import { asCanonicalEventId, type CanonicalEventId, type TennisMatchOutcome } from "./types.ts";
import { sortPlayerPair, winnerOutcomeBit } from "./event-id.ts";
import { CACHE_DIR } from "../../research/paths.ts";

export const ITF_STADION_SOURCE = "itf-stadion";
export const ITF_STADION_BASE =
  "https://api.itf-production.sports-data.stadion.io/custom/wttCompleteMatchList";
export const ITF_LIVE_REFERER = "https://www.itftennis.com/en/world-tennis-tour-live/";

export type ItfStadionFetchImpl = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type StadionTour = "ITF-M" | "ITF-W" | "ITF";

/**
 * Derive ITF tour from Stadion level/category text (+ optional tennisId).
 * Prefer tennisId W-/M- prefix; never match `/men/` inside "women".
 */
export function tourFromStadionLevel(level: string, tennisId?: string): StadionTour {
  const id = tennisId?.trim() ?? "";
  if (id.startsWith("M-")) return "ITF-M";
  if (id.startsWith("W-")) return "ITF-W";
  const text = level.trim();
  if (/\bwomen\b|\bw\d+\b/i.test(text)) return "ITF-W";
  if (/\bmen\b|\bm\d+\b/i.test(text)) return "ITF-M";
  return "ITF";
}

export type PrimaryResultMatch = {
  eventId: CanonicalEventId;
  tour: StadionTour;
  level: string;
  tournament: string;
  tournamentTennisId: string;
  location: string;
  surface: string;
  format: "singles" | "doubles";
  round: string;
  playerA: string;
  playerB: string;
  winner: string;
  loser: string;
  startTs: string;
  endTs: string | null;
  outcome: TennisMatchOutcome;
  scoreText: string;
  sourceMatchId: string;
  sourceUrl: string;
  sourceRowHash: string;
  fetchedTs: number;
};

export type ItfStadionCollectSummary = {
  day: string;
  sourceUrl: string;
  fetchedTs: number;
  cacheHit: boolean;
  matchesParsed: number;
  singles: number;
  doubles: number;
  eventsInserted: number;
  eventsUpdated: number;
  resolutionsInserted: number;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function itfStadionDayUrl(dayIso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayIso)) {
    throw new Error(`ITF Stadion day must be YYYY-MM-DD, got ${dayIso}`);
  }
  return `${ITF_STADION_BASE}/${dayIso}`;
}

export function cachePathForDay(dayIso: string, cacheDir = join(CACHE_DIR, "itf-stadion")): string {
  return join(cacheDir, `${dayIso}.json`);
}

export async function fetchItfStadionDay(
  dayIso: string,
  options: {
    fetchImpl?: ItfStadionFetchImpl;
    cacheDir?: string;
    /** Reuse cached body newer than this many ms (default 6h). */
    maxAgeMs?: number;
    force?: boolean;
  } = {},
): Promise<{ wire: unknown; sourceUrl: string; fetchedTs: number; cacheHit: boolean }> {
  const sourceUrl = itfStadionDayUrl(dayIso);
  const cacheDir = options.cacheDir ?? join(CACHE_DIR, "itf-stadion");
  const cachePath = cachePathForDay(dayIso, cacheDir);
  const maxAgeMs = options.maxAgeMs ?? 6 * 60 * 60 * 1000;
  mkdirSync(cacheDir, { recursive: true });

  if (!options.force) {
    const cached = Bun.file(cachePath);
    if (await cached.exists()) {
      const st = await cached.stat();
      if (Date.now() - st.mtimeMs <= maxAgeMs) {
        return {
          wire: await cached.json(),
          sourceUrl,
          fetchedTs: Math.floor(st.mtimeMs),
          cacheHit: true,
        };
      }
    }
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(sourceUrl, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Origin: "https://www.itftennis.com",
      Referer: ITF_LIVE_REFERER,
      "User-Agent":
        "KalshiBotResearch/0.2 (+local; polite ITF results collector; cache-first)",
    },
  });
  if (!res.ok) {
    throw new Error(`ITF Stadion ${dayIso}: ${res.status} ${res.statusText}`);
  }
  const wire: unknown = await res.json();
  const fetchedTs = Date.now();
  await Bun.write(cachePath, JSON.stringify(wire));
  return { wire, sourceUrl, fetchedTs, cacheHit: false };
}

function sideLabel(side: Record<string, unknown>): string | null {
  const players = Array.isArray(side.sidePlayer) ? side.sidePlayer : [];
  const names: string[] = [];
  for (const sp of players) {
    if (!isRecord(sp) || !isRecord(sp.player)) continue;
    const person = isRecord(sp.player.person) ? sp.player.person : null;
    const name =
      asString(person?._name) ??
      ([asString(person?.firstName), asString(person?.lastName)].filter(Boolean).join(" ") ||
        asString(sp.player._name));
    if (name) names.push(name);
  }
  if (!names.length) return null;
  return names.join(" / ");
}

function scoreTextFromSides(sides: Array<Record<string, unknown>>): string {
  if (sides.length !== 2) return "";
  const a = sides[0]!;
  const b = sides[1]!;
  const aSets = Array.isArray(a.sideSets) ? a.sideSets : [];
  const bSets = Array.isArray(b.sideSets) ? b.sideSets : [];
  const byNum = new Map<number, { a: number; b: number; tbA?: number; tbB?: number }>();
  for (const raw of aSets) {
    if (!isRecord(raw)) continue;
    const n = Number(raw.setNumber);
    const score = Number(raw.setScore);
    if (!Number.isFinite(n) || !Number.isFinite(score)) continue;
    const cur = byNum.get(n) ?? { a: 0, b: 0 };
    cur.a = score;
    if (Number(raw.setTieBreakScore) > 0) cur.tbA = Number(raw.setTieBreakScore);
    byNum.set(n, cur);
  }
  for (const raw of bSets) {
    if (!isRecord(raw)) continue;
    const n = Number(raw.setNumber);
    const score = Number(raw.setScore);
    if (!Number.isFinite(n) || !Number.isFinite(score)) continue;
    const cur = byNum.get(n) ?? { a: 0, b: 0 };
    cur.b = score;
    if (Number(raw.setTieBreakScore) > 0) cur.tbB = Number(raw.setTieBreakScore);
    byNum.set(n, cur);
  }
  return [...byNum.entries()]
    .sort((x, y) => x[0] - y[0])
    .filter(([, s]) => s.a + s.b > 0)
    .map(([, s]) => {
      let bit = `${s.a}-${s.b}`;
      if (s.tbA != null || s.tbB != null) bit += `(${s.tbA ?? 0}-${s.tbB ?? 0})`;
      return bit;
    })
    .join(" ");
}

function mintPrimaryEventId(matchId: string): CanonicalEventId {
  return asCanonicalEventId(sha3Hex(`itf|stadion|${matchId}`).slice(0, 32));
}

/** Wire boundary: Stadion day payload → completed primary matches. */
export function parseItfStadionDayWire(
  wire: unknown,
  meta: { sourceUrl: string; fetchedTs: number },
): PrimaryResultMatch[] {
  if (!isRecord(wire) || !isRecord(wire.data)) {
    throw new Error("ITF Stadion wire must be { data: { ...tournaments } }");
  }
  const out: PrimaryResultMatch[] = [];

  for (const tournament of Object.values(wire.data)) {
    if (!isRecord(tournament)) continue;
    const tournamentName = asString(tournament._name) ?? "ITF";
    const tournamentTennisId = asString(tournament.tennisId) ?? "";
    const category = isRecord(tournament.eventCategory)
      ? (asString(tournament.eventCategory._name) ?? "")
      : "";
    const surface = isRecord(tournament.surface)
      ? (asString(tournament.surface._name) ?? "unknown")
      : "unknown";
    const location = isRecord(tournament.venue)
      ? (asString(tournament.venue.city) ?? asString(tournament.venue._name) ?? "")
      : "";
    const tour = tourFromStadionLevel(category, tournamentTennisId);
    const courts = isRecord(tournament.courts) ? tournament.courts : {};

    for (const games of Object.values(courts)) {
      if (!Array.isArray(games)) continue;
      for (const raw of games) {
        if (!isRecord(raw)) continue;
        const status = isRecord(raw.matchStatus) ? raw.matchStatus : null;
        const stateType = asString(status?.stateType);
        if (stateType !== "post") continue;
        const matchId = asString(raw.id);
        const winnerSideId = asString(raw.winnerSideId);
        if (!matchId || !winnerSideId) continue;
        const sides = (Array.isArray(raw.sides) ? raw.sides : []).filter(isRecord);
        if (sides.length !== 2) continue;
        const labels = sides.map(sideLabel);
        if (!labels[0] || !labels[1]) continue;
        const winnerSide = sides.find((s) => asString(s.id) === winnerSideId);
        const loserSide = sides.find((s) => asString(s.id) !== winnerSideId);
        if (!winnerSide || !loserSide) continue;
        const winner = sideLabel(winnerSide);
        const loser = sideLabel(loserSide);
        if (!winner || !loser) continue;
        const nPlayers = sides.reduce(
          (n, s) => n + (Array.isArray(s.sidePlayer) ? s.sidePlayer.length : 0),
          0,
        );
        const format = nPlayers >= 4 ? "doubles" : "singles";
        const [playerA, playerB] = sortPlayerPair(labels[0], labels[1]);
        const startTs =
          asString(raw.actualStartDate) ??
          (asString(raw.dateStartLocal)
            ? `${asString(raw.dateStartLocal)}T12:00:00.000Z`
            : null);
        if (!startTs) continue;
        const statusName = asString(status?.name) ?? "COMPLETE";
        const outcome: TennisMatchOutcome = /retir/i.test(statusName)
          ? "retirement"
          : /walk/i.test(statusName)
            ? "walkover"
            : "completed";

        out.push({
          eventId: mintPrimaryEventId(matchId),
          tour,
          // Keep format token in level so bridge/query can detect doubles even when
          // category is a W100/M15 label without the word "doubles".
          level:
            format === "doubles"
              ? `${category || "itf"} doubles`.trim()
              : category || "itf-singles",
          tournament: tournamentName,
          tournamentTennisId,
          location,
          surface,
          format,
          round: "unknown",
          playerA,
          playerB,
          winner,
          loser,
          startTs,
          endTs: asString(raw.actualEndDate),
          outcome,
          scoreText: scoreTextFromSides(sides),
          sourceMatchId: matchId,
          sourceUrl: meta.sourceUrl,
          sourceRowHash: hashItfStadionRow(matchId),
          fetchedTs: meta.fetchedTs,
        });
      }
    }
  }

  return out;
}

export function hashItfStadionRow(matchId: string): string {
  return sha3Hex(`itf-stadion|${matchId}`);
}

export { winnerOutcomeBit };
