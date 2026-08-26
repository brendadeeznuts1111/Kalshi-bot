/**
 * Bun.WebView + Chrome CDP capture of Pandora Socket.IO frames.
 * Library form of tools/partner-webview-ws-capture.ts.
 *
 * @see https://bun.com/docs/runtime/webview
 * @see https://bun.com/docs/runtime/webview#cdp
 */
// @see https://bun.com/docs/runtime/webview
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { defaultLiveWidgetUrl } from "../domain/index.ts";
import {
  readArtifactIntegrity,
  type SnapshotArtifactIntegrity,
} from "../institutions/event-store/visual-snapshot-meta.ts";
import type { WebViewWsFrame } from "./webview-ws-ingest.ts";
import {
  parseCdpWebSocketClosed,
  parseCdpWebSocketCreated,
  parseCdpWebSocketFrame,
  type CdpWebSocketClosed,
  type CdpWebSocketCreated,
  type CdpWebSocketFrame,
} from "./webview-cdp-events.ts";

export type PartnerWebViewSnapshotMeta = {
  schemaVersion: 1;
  capturedAt: string;
  runtime: { bunVersion: string; bunRevision: string };
  webview: {
    backend: "chrome";
    width: 1280;
    height: 800;
    cdpNetworkCapture: true;
  };
  artifact: SnapshotArtifactIntegrity;
};

export type WebViewCaptureOptions = {
  /** plive sport widget id (default 220 table tennis) */
  sport?: string;
  /** Override full start URL (e.g. signed LIVE_DESKTOP_URL) */
  url?: string;
  seconds?: number;
  outDir?: string;
};

export type WebViewCaptureResult = {
  startUrl: string;
  finalUrl: string;
  seconds: number;
  frames: WebViewWsFrame[];
  outPath: string;
  summaryPath: string;
  subscribeMsg: string | null;
  coeffSubscribeCount: number;
  frameCount: number;
  snapshotMeta: PartnerWebViewSnapshotMeta;
};

export async function capturePandoraViaWebView(
  options: WebViewCaptureOptions = {},
): Promise<WebViewCaptureResult> {
  if (typeof Bun.WebView !== "function") {
    throw new Error("Bun.WebView unavailable in the active Bun runtime/build");
  }

  const seconds = Math.min(
    Math.max(Number(options.seconds ?? 25) || 25, 5),
    120,
  );
  const sport = options.sport ?? "220";
  const startUrl = options.url ?? defaultLiveWidgetUrl(sport);
  const outDir =
    options.outDir ??
    join(process.cwd(), "research/cache/partner-ws-capture");
  mkdirSync(outDir, { recursive: true });
  const stamp = Date.now();
  const outPath = join(outDir, `ws-${stamp}.jsonl`);
  const summaryPath = join(outDir, `ws-${stamp}-summary.json`);

  const frames: WebViewWsFrame[] = [];
  const requestUrlById = new Map<string, string>();

  await using view = new Bun.WebView({
    backend: { type: "chrome", url: false },
    width: 1280,
    height: 800,
    console: (type, ...args) => {
      if (type === "error" || type === "warn") {
        console.error(`[page:${type}]`, ...args);
      }
    },
  });

  await view.navigate("about:blank");
  await view.cdp("Network.enable", {});

  view.addEventListener<CdpWebSocketCreated>("Network.webSocketCreated", (ev) => {
    const data = parseCdpWebSocketCreated(ev);
    const safeUrl = data?.url ? redactCaptureUrl(data.url) : undefined;
    if (data?.requestId && safeUrl) requestUrlById.set(data.requestId, safeUrl);
    frames.push({
      t: Date.now(),
      dir: "created",
      ...(safeUrl !== undefined ? { url: safeUrl } : {}),
      ...(data?.requestId !== undefined ? { requestId: data.requestId } : {}),
    });
  });

  const pushFrame = (
    dir: "sent" | "recv",
    data: CdpWebSocketFrame,
  ) => {
    const payload = data?.response?.payloadData ?? "";
    const url = data?.requestId ? requestUrlById.get(data.requestId) : undefined;
    frames.push({
      t: Date.now(),
      dir,
      payload,
      ...(data?.requestId !== undefined ? { requestId: data.requestId } : {}),
      ...(url !== undefined ? { url } : {}),
    });
  };

  view.addEventListener<CdpWebSocketFrame>("Network.webSocketFrameSent", (ev) => {
    pushFrame("sent", parseCdpWebSocketFrame(ev));
  });

  view.addEventListener<CdpWebSocketFrame>("Network.webSocketFrameReceived", (ev) => {
    pushFrame("recv", parseCdpWebSocketFrame(ev));
  });

  view.addEventListener<CdpWebSocketClosed>("Network.webSocketClosed", (ev) => {
    const data = parseCdpWebSocketClosed(ev);
    const url = data?.requestId ? requestUrlById.get(data.requestId) : undefined;
    frames.push({
      t: Date.now(),
      dir: "closed",
      ...(data?.requestId !== undefined ? { requestId: data.requestId } : {}),
      ...(url !== undefined ? { url } : {}),
    });
  });

  await view.navigate(startUrl);

  const wantHash = `#!/sport/${sport}`;
  try {
    await view.evaluate(`
      (() => {
        if (!location.hash.includes("sport/${sport}")) {
          location.hash = ${JSON.stringify(wantHash)};
        }
        return location.href;
      })()
    `);
  } catch {
    /* non-fatal */
  }

  await Bun.sleep(seconds * 1000);

  await Bun.write(
    outPath,
    frames.map((f) => JSON.stringify(f)).join("\n") + "\n",
  );
  const artifact = await readArtifactIntegrity(outPath);
  if (!artifact) throw new Error("WebView capture artifact integrity unavailable");
  const snapshotMeta: PartnerWebViewSnapshotMeta = {
    schemaVersion: 1,
    capturedAt: new Date(stamp).toISOString(),
    runtime: { bunVersion: Bun.version, bunRevision: Bun.revision },
    webview: {
      backend: "chrome",
      width: 1280,
      height: 800,
      cdpNetworkCapture: true,
    },
    artifact,
  };

  const sent42 = frames.filter(
    (f) => f.dir === "sent" && (f.payload?.startsWith("42") ?? false),
  );
  const subscribeMsgs = sent42.filter((f) => {
    const p = f.payload ?? "";
    return (
      p.includes("setSocketMetadata") ||
      p.includes("subscribeSystemEvents") ||
      p.includes('"subscribe"')
    );
  });
  const coeffSubscribes = sent42.filter((f) =>
    (f.payload ?? "").includes("eventCoefficients"),
  );

  const summary = {
    outPath,
    summaryPath,
    startUrl: redactCaptureUrl(startUrl),
    finalUrl: redactCaptureUrl(String(view.url ?? startUrl)),
    seconds,
    frameCount: frames.length,
    subscribeMsg: subscribeMsgs[0]?.payload ?? null,
    coeffSubscribeCount: coeffSubscribes.length,
    snapshotMeta,
  };
  await Bun.write(summaryPath, JSON.stringify(summary, null, 2) + "\n");

  return {
    startUrl,
    finalUrl: String(view.url ?? startUrl),
    seconds,
    frames,
    outPath,
    summaryPath,
    subscribeMsg: summary.subscribeMsg,
    coeffSubscribeCount: coeffSubscribes.length,
    frameCount: frames.length,
    snapshotMeta,
  };
}

/** Strip credentials/query/hash from persisted capture summaries. Raw capture stays local. */
export function redactCaptureUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "[redacted-invalid-url]";
  }
}
