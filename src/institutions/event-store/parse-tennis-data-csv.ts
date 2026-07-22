import {
  decimalToImpliedProb,
  hashSourceRow,
  mintCanonicalEventId,
  sortPlayerPair,
} from "./event-id.ts";
import type { TennisHistoryMatch, TennisMatchOutcome, TennisTour } from "./types.ts";

const TENNIS_DATA_SOURCE = "tennis-data.co.uk";

function normalizeHeader(raw: string): string {
  return raw.trim().replace(/^\uFEFF/, "").toLowerCase();
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function field(row: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const hit = row[key];
    if (hit != null && hit.trim() !== "") return hit.trim();
  }
  return "";
}

function parseOptionalNumber(raw: string): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalOdds(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 1) return null;
  return n;
}

/** tennis-data.co.uk dates are DD/MM/YYYY (sometimes DD/MM/YY). */
export function parseTennisDataDate(raw: string): string | null {
  const trimmed = raw.trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(trimmed);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  return `${iso}T12:00:00.000Z`;
}

function inferTour(row: Record<string, string>, fileName: string): TennisTour | null {
  if (field(row, "wta")) return "WTA";
  if (field(row, "atp")) return "ATP";
  const lower = fileName.toLowerCase();
  if (lower.includes("wta")) return "WTA";
  if (lower.includes("atp")) return "ATP";
  if (field(row, "tier")) return "WTA";
  if (field(row, "series")) return "ATP";
  return null;
}

function parseOutcome(comment: string): TennisMatchOutcome {
  const c = comment.trim().toLowerCase();
  if (!c || c === "completed") return "completed";
  if (c.includes("walkover") || c.includes("w/o")) return "walkover";
  if (c.includes("retire")) return "retirement";
  return "unknown";
}

function rowToRecord(headers: string[], values: string[]): Record<string, string> {
  const row: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) {
    row[headers[i]!] = values[i] ?? "";
  }
  return row;
}

export function parseTennisDataCsv(text: string, sourceFile: string): TennisHistoryMatch[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]!).map(normalizeHeader);
  const out: TennisHistoryMatch[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]!);
    const row = rowToRecord(headers, values);
    const tour = inferTour(row, sourceFile);
    const winner = field(row, "winner");
    const loser = field(row, "loser");
    const tournament = field(row, "tournament");
    const round = field(row, "round");
    const surface = field(row, "surface");
    const dateRaw = field(row, "date", "data");
    const startTs = parseTennisDataDate(dateRaw);

    if (!tour || !winner || !loser || !tournament || !round || !surface || !startTs) {
      continue;
    }

    const [playerA, playerB] = sortPlayerPair(winner, loser);
    const level = tour === "WTA" ? field(row, "tier", "series") || "unknown" : field(row, "series", "tier") || "unknown";
    const eventId = mintCanonicalEventId({
      tour,
      startTs,
      tournament,
      round,
      playerA,
      playerB,
    });
    const sourceRowHash = hashSourceRow([sourceFile, String(i + 1), ...values]);

    out.push({
      tour,
      level,
      tournament,
      location: field(row, "location"),
      surface,
      court: field(row, "court"),
      round,
      bestOf: parseOptionalNumber(field(row, "best of", "bestof")),
      playerA,
      playerB,
      winner,
      loser,
      startTs,
      outcome: parseOutcome(field(row, "comment")),
      winnerRank: parseOptionalNumber(field(row, "wrank")),
      loserRank: parseOptionalNumber(field(row, "lrank")),
      pinnacle: {
        winner: parseOptionalOdds(field(row, "psw")),
        loser: parseOptionalOdds(field(row, "psl")),
      },
      bet365: {
        winner: parseOptionalOdds(field(row, "b365w")),
        loser: parseOptionalOdds(field(row, "b365l")),
      },
      sourceFile,
      sourceRow: i + 1,
      sourceRowHash,
      eventId,
    });
  }

  return out;
}

export function impliedProbFromDecimal(decimalOdds: number | null): number | null {
  if (decimalOdds == null) return null;
  return decimalToImpliedProb(decimalOdds);
}

export { TENNIS_DATA_SOURCE };
