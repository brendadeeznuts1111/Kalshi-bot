/**
 * Ingest Pandora WS frames captured via Bun.WebView CDP into CoefficientStore.
 *
 * Frame pairing (as observed on plive):
 *   ← 451-["live.main.…eventCoefficients.{id}",{_placeholder:true,num:0}]
 *   ← H4sI…   (gzip base64 attachment body)
 *
 * @see tools/partner-webview-ws-capture.ts
 * @see src/partner/fantasy-ultra/coefficients.ts
 */
import {
  decodePandoraAttachment,
  eventIdFromCoefficientRoom,
  extractCoefficientLines,
  parseBinaryEventHeader,
} from "./fantasy-ultra/coefficients.ts";
import {
  CoefficientStore,
  type CoefficientIngest,
} from "./fantasy-ultra/coefficient-store.ts";

export type WebViewWsFrame = {
  t?: number;
  dir: "sent" | "recv" | "created" | "closed" | "error" | string;
  url?: string;
  payload?: string;
  requestId?: string;
};

export type WebViewIngestReport = {
  frames: number;
  recv: number;
  binaryHeaders: number;
  gzipBodies: number;
  coefficientIngests: number;
  pricedEvents: number;
  pricedLines: number;
  rooms: string[];
  errors: string[];
};

function isGzipB64(payload: string): boolean {
  return payload.startsWith("H4sI");
}

/**
 * Walk CDP JSONL frames in order; pair 451- headers with following gzip bodies.
 */
export function ingestWebViewWsFrames(
  frames: WebViewWsFrame[],
  store: CoefficientStore = new CoefficientStore(),
): { store: CoefficientStore; report: WebViewIngestReport } {
  const errors: string[] = [];
  const rooms = new Set<string>();
  let binaryHeaders = 0;
  let gzipBodies = 0;
  let coefficientIngests = 0;
  let pending:
    | {
        room: string;
        eventId: number | null;
      }
    | null = null;

  const recv = frames.filter((f) => f.dir === "recv");

  for (const f of recv) {
    const payload = f.payload ?? "";
    if (!payload) continue;

    const header = parseBinaryEventHeader(payload);
    if (header) {
      binaryHeaders++;
      const room = header.eventName;
      rooms.add(room);
      pending = {
        room,
        eventId: eventIdFromCoefficientRoom(room),
      };
      continue;
    }

    if (isGzipB64(payload) && pending) {
      gzipBodies++;
      try {
        const envelope = decodePandoraAttachment(payload);
        const eventId = pending.eventId;
        const lines =
          eventId != null
            ? extractCoefficientLines(eventId, envelope.payload)
            : [];
        const info: CoefficientIngest = {
          room: pending.room,
          eventId,
          envelope,
          lines,
        };
        store.ingest(info);
        if (eventId != null && (lines.length > 0 || !envelope.isDiff)) {
          coefficientIngests++;
        }
      } catch (e) {
        errors.push(
          `${pending.room}: ${e instanceof Error ? e.message : String(e)}`.slice(
            0,
            200,
          ),
        );
      }
      pending = null;
    }
  }

  return {
    store,
    report: {
      frames: frames.length,
      recv: recv.length,
      binaryHeaders,
      gzipBodies,
      coefficientIngests,
      pricedEvents: store.pricedEventCount(),
      pricedLines: store.lineCount(),
      rooms: [...rooms].sort(),
      errors: errors.slice(0, 20),
    },
  };
}

/** Load JSONL capture file → CoefficientStore. */
export async function ingestWebViewWsJsonl(
  path: string,
  store?: CoefficientStore,
): Promise<{ store: CoefficientStore; report: WebViewIngestReport; path: string }> {
  const text = await Bun.file(path).text();
  const frames: WebViewWsFrame[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      frames.push(JSON.parse(line) as WebViewWsFrame);
    } catch {
      /* skip bad lines */
    }
  }
  const result = ingestWebViewWsFrames(frames, store);
  return { ...result, path };
}

/** Latest ws-*.jsonl under research/cache/partner-ws-capture (or custom dir). */
export async function findLatestWebViewCapture(
  dir = "research/cache/partner-ws-capture",
): Promise<string | null> {
  const glob = new Bun.Glob("ws-*.jsonl");
  let best: { path: string; m: number } | null = null;
  for await (const name of glob.scan({ cwd: dir, absolute: false })) {
    const path = `${dir.replace(/\/$/, "")}/${name}`;
    const f = Bun.file(path);
    if (!(await f.exists())) continue;
    const m = f.lastModified;
    if (!best || m > best.m) best = { path, m };
  }
  return best?.path ?? null;
}
