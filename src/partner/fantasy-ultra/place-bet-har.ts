/**
 * Offline Chrome HAR → PlaceBet endpoint map.
 *
 * Never invents a place URL. Scores HAR entries whose **response** looks like
 * the known betGroups wire, then records request URL / method / content-type /
 * body keys from that capture.
 *
 * @see docs/PARTNER-FANTASY-ULTRA.md — Bet ticket wire
 */
// @see https://bun.com/docs/api/file-io

export type PlaceBetBodyEncoding = "json" | "form" | "unknown";

export type PlaceBetEndpointMap = {
  /** Schema version for this artifact */
  version: 1;
  generatedAt: string;
  source: {
    harPath?: string;
    entryIndex?: number;
    pageRef?: string | null;
  };
  /** Absolute URL observed on the PlaceBet (or open-ticket) request */
  url: string;
  method: string;
  contentType: string | null;
  encoding: PlaceBetBodyEncoding;
  /** Top-level request body keys (values redacted) */
  requestKeys: string[];
  /** Sample request body with secret-like values redacted */
  requestBodySample: unknown | null;
  /** Response had betGroups + e===0 */
  responseOk: boolean;
  responseGroupCount: number;
  /** Ticket numbers seen in the winning response (audit only) */
  sampleTicketNumbers: string[];
  /** Confidence 0–1 from scoring */
  score: number;
  notes: string[];
};

type HarHeader = { name?: string; value?: string };
type HarPostData = {
  mimeType?: string;
  text?: string;
  params?: Array<{ name?: string; value?: string }>;
};
type HarEntry = {
  pageref?: string;
  startedDateTime?: string;
  request?: {
    method?: string;
    url?: string;
    headers?: HarHeader[];
    postData?: HarPostData;
  };
  response?: {
    status?: number;
    headers?: HarHeader[];
    content?: { mimeType?: string; text?: string; encoding?: string };
  };
};

type HarDoc = {
  log?: { entries?: HarEntry[] };
  entries?: HarEntry[];
};

function headerValue(headers: HarHeader[] | undefined, name: string): string | null {
  if (!headers) return null;
  const want = name.toLowerCase();
  for (const h of headers) {
    if ((h.name ?? "").toLowerCase() === want) return h.value?.trim() || null;
  }
  return null;
}

function decodeContentText(content: HarEntry["response"] extends infer R
  ? R extends { content?: infer C }
    ? C | undefined
    : never
  : never): string | null {
  if (!content || typeof content !== "object") return null;
  const c = content as { text?: string; encoding?: string };
  if (typeof c.text !== "string" || !c.text) return null;
  if ((c.encoding ?? "").toLowerCase() === "base64") {
    try {
      return Buffer.from(c.text, "base64").toString("utf8");
    } catch {
      return null;
    }
  }
  return c.text;
}

function tryParseJson(text: string | null | undefined): unknown | null {
  if (!text?.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** True when object looks like known betGroups ticket wire. */
export function looksLikeBetGroupsWire(wire: unknown): boolean {
  if (!wire || typeof wire !== "object" || Array.isArray(wire)) return false;
  const w = wire as Record<string, unknown>;
  if (!Array.isArray(w.betGroups)) return false;
  return true;
}

function ticketNumbersFromWire(wire: unknown): string[] {
  if (!looksLikeBetGroupsWire(wire)) return [];
  const groups = (wire as { betGroups: Array<Record<string, unknown>> }).betGroups;
  const out: string[] = [];
  for (const g of groups) {
    const t = g?.ticketNumber;
    if (t != null && String(t).trim()) out.push(String(t).trim());
  }
  return out;
}

function scoreEntry(entry: HarEntry, responseJson: unknown): number {
  let score = 0;
  const method = (entry.request?.method ?? "GET").toUpperCase();
  if (method === "POST" || method === "PUT") score += 0.25;
  if (looksLikeBetGroupsWire(responseJson)) score += 0.45;
  const groups = looksLikeBetGroupsWire(responseJson)
    ? (responseJson as { betGroups: unknown[] }).betGroups
    : [];
  if (groups.length > 0) score += 0.1;
  const e = (responseJson as { e?: unknown })?.e;
  if (e === 0 || e === "0") score += 0.1;
  const url = entry.request?.url ?? "";
  if (/place|bet|ticket|wager|order/i.test(url)) score += 0.08;
  if (/betFactory|bet-factory|ultra|cloud\/api/i.test(url)) score += 0.05;
  const status = entry.response?.status ?? 0;
  if (status >= 200 && status < 300) score += 0.05;
  return Math.min(1, score);
}

const SECRET_KEY =
  /pass|token|bearer|auth|password|secret|jwt|cookie|session/i;

function redactValue(key: string, value: unknown): unknown {
  if (SECRET_KEY.test(key)) {
    if (typeof value === "string") {
      return value.length <= 4 ? "[redacted]" : `${value.slice(0, 2)}…[len=${value.length}]`;
    }
    return "[redacted]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 5).map((v, i) => redactValue(String(i), v));
  }
  if (value && typeof value === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      o[k] = redactValue(k, v);
    }
    return o;
  }
  return value;
}

function parseRequestBody(entry: HarEntry): {
  encoding: PlaceBetBodyEncoding;
  keys: string[];
  sample: unknown | null;
  contentType: string | null;
} {
  const ct =
    headerValue(entry.request?.headers, "content-type") ||
    entry.request?.postData?.mimeType ||
    null;
  const post = entry.request?.postData;
  if (!post) {
    return { encoding: "unknown", keys: [], sample: null, contentType: ct };
  }

  if (post.params && post.params.length > 0) {
    const sample: Record<string, unknown> = {};
    const keys: string[] = [];
    for (const p of post.params) {
      const name = (p.name ?? "").trim();
      if (!name) continue;
      keys.push(name);
      sample[name] = redactValue(name, p.value ?? "");
    }
    return {
      encoding: "form",
      keys,
      sample,
      contentType: ct ?? "application/x-www-form-urlencoded",
    };
  }

  const text = post.text ?? "";
  const json = tryParseJson(text);
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const keys = Object.keys(json as object);
    return {
      encoding: "json",
      keys,
      sample: redactValue("body", json),
      contentType: ct ?? "application/json",
    };
  }

  // form-encoded string without params array
  if (text.includes("=") && !text.trimStart().startsWith("{")) {
    const sample: Record<string, unknown> = {};
    const keys: string[] = [];
    for (const part of text.split("&")) {
      const eq = part.indexOf("=");
      const rawK = eq >= 0 ? part.slice(0, eq) : part;
      const rawV = eq >= 0 ? part.slice(eq + 1) : "";
      let k = rawK;
      let v = rawV;
      try {
        k = decodeURIComponent(rawK.replace(/\+/g, " "));
        v = decodeURIComponent(rawV.replace(/\+/g, " "));
      } catch {
        /* keep raw */
      }
      if (!k) continue;
      keys.push(k);
      sample[k] = redactValue(k, v);
    }
    return {
      encoding: "form",
      keys,
      sample,
      contentType: ct ?? "application/x-www-form-urlencoded",
    };
  }

  return {
    encoding: "unknown",
    keys: [],
    sample: text ? { _rawLen: text.length } : null,
    contentType: ct,
  };
}

export type PlaceBetHarCandidate = {
  index: number;
  score: number;
  url: string;
  method: string;
  responseJson: unknown;
  entry: HarEntry;
};

export function listPlaceBetHarCandidates(har: unknown): PlaceBetHarCandidate[] {
  const doc = har as HarDoc;
  const entries = doc.log?.entries ?? doc.entries ?? [];
  if (!Array.isArray(entries)) return [];

  const out: PlaceBetHarCandidate[] = [];
  entries.forEach((entry, index) => {
    const text = decodeContentText(entry.response?.content);
    const responseJson = tryParseJson(text);
    if (!responseJson) return;
    const score = scoreEntry(entry, responseJson);
    if (score < 0.5) return;
    if (!looksLikeBetGroupsWire(responseJson)) return;
    const url = entry.request?.url?.trim() ?? "";
    if (!url) return;
    out.push({
      index,
      score,
      url,
      method: (entry.request?.method ?? "POST").toUpperCase(),
      responseJson,
      entry,
    });
  });
  out.sort((a, b) => b.score - a.score || a.index - b.index);
  return out;
}

export function placeBetMapFromCandidate(
  candidate: PlaceBetHarCandidate,
  options?: { harPath?: string },
): PlaceBetEndpointMap {
  const body = parseRequestBody(candidate.entry);
  const e = (candidate.responseJson as { e?: unknown })?.e;
  const responseOk = e === 0 || e === "0";
  const groups = looksLikeBetGroupsWire(candidate.responseJson)
    ? (candidate.responseJson as { betGroups: unknown[] }).betGroups
    : [];
  const notes: string[] = [
    "Derived from HAR response matching betGroups wire — verify request body before live placeOrder.",
    "Set FANTASY402_PLACE_BET_URL to map.url (or pass placeOrderUrl to adapter) only after review.",
  ];
  if (!body.keys.length) {
    notes.push(
      "Request body keys empty in HAR — may need Network preserve log + full postData.",
    );
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: {
      harPath: options?.harPath,
      entryIndex: candidate.index,
      pageRef: candidate.entry.pageref ?? null,
    },
    url: candidate.url,
    method: candidate.method,
    contentType: body.contentType,
    encoding: body.encoding,
    requestKeys: body.keys,
    requestBodySample: body.sample,
    responseOk,
    responseGroupCount: groups.length,
    sampleTicketNumbers: ticketNumbersFromWire(candidate.responseJson),
    score: candidate.score,
    notes,
  };
}

/**
 * Parse HAR JSON text/object → best PlaceBetEndpointMap or null.
 */
export function extractPlaceBetMapFromHar(
  har: unknown,
  options?: { harPath?: string; minScore?: number },
): {
  map: PlaceBetEndpointMap | null;
  candidates: Array<Omit<PlaceBetHarCandidate, "entry" | "responseJson"> & {
    ticketNumbers: string[];
  }>;
} {
  const minScore = options?.minScore ?? 0.55;
  const all = listPlaceBetHarCandidates(har);
  const candidates = all.map((c) => ({
    index: c.index,
    score: c.score,
    url: c.url,
    method: c.method,
    ticketNumbers: ticketNumbersFromWire(c.responseJson),
  }));
  const best = all.find((c) => c.score >= minScore) ?? null;
  return {
    map: best ? placeBetMapFromCandidate(best, options) : null,
    candidates,
  };
}

export async function loadHarFile(path: string): Promise<unknown> {
  const text = await Bun.file(path).text();
  return JSON.parse(text) as unknown;
}

/**
 * Pull every betGroups response body from a HAR for offline ticket ingest.
 */
export function extractBetGroupsWiresFromHar(har: unknown): unknown[] {
  const doc = har as HarDoc;
  const entries = doc.log?.entries ?? doc.entries ?? [];
  const out: unknown[] = [];
  for (const entry of entries) {
    const text = decodeContentText(entry.response?.content);
    const json = tryParseJson(text);
    if (looksLikeBetGroupsWire(json)) out.push(json);
  }
  return out;
}
