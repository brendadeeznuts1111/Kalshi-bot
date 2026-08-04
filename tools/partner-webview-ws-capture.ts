#!/usr/bin/env bun
/**
 * Capture Pandora Socket.IO frames via Bun.WebView + Chrome CDP.
 *
 * @see https://bun.com/blog/bun-v1.3.12#bun-webview-headless-browser-automation
 * @see https://bun.com/docs/runtime/webview
 *
 * Usage:
 *   bun run partner:webview-ws-capture
 *   bun run partner:webview-ws-capture -- --url=https://plive.sportswidgets.pro/live/ --seconds=20
 *   bun run partner:webview-ws-capture -- --url="$LIVE_DESKTOP_URL" --seconds=30
 *
 * Writes JSONL under research/cache/partner-ws-capture/ (gitignored cache).
 */
// @see https://bun.com/docs/api/websockets
import { mkdirSync } from "node:fs";
import { join } from "node:path";

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const seconds = Math.min(Math.max(Number(argValue("seconds") ?? "20") || 20, 5), 120);
const startUrl =
  argValue("url") ?? "https://plive.sportswidgets.pro/live/";
const outDir = join(
  process.cwd(),
  "research/cache/partner-ws-capture",
);
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `ws-${Date.now()}.jsonl`);

type Frame = {
  t: number;
  dir: "sent" | "recv" | "created" | "closed" | "error";
  url?: string;
  payload?: string;
  requestId?: string;
};

const frames: Frame[] = [];

if (typeof Bun.WebView !== "function") {
  console.error("Bun.WebView unavailable — need Bun ≥1.3.12 / 1.4 with WebView");
  process.exit(1);
}

console.error(`webview capture → ${startUrl} for ${seconds}s (chrome CDP)`);

await using view = new Bun.WebView({
  backend: { type: "chrome", url: false },
  width: 1280,
  height: 800,
  console: globalThis.console,
});

await view.navigate("about:blank");
await view.cdp("Network.enable", {});

view.addEventListener("Network.webSocketCreated", (ev) => {
  const d = (ev as MessageEvent).data as {
    url?: string;
    requestId?: string;
  };
  frames.push({
    t: Date.now(),
    dir: "created",
    url: d?.url,
    requestId: d?.requestId,
  });
  console.error("WS created", d?.url?.slice(0, 100));
});

view.addEventListener("Network.webSocketFrameSent", (ev) => {
  const d = (ev as MessageEvent).data as {
    response?: { payloadData?: string };
    requestId?: string;
  };
  const payload = d?.response?.payloadData ?? "";
  frames.push({
    t: Date.now(),
    dir: "sent",
    payload,
    requestId: d?.requestId,
  });
  if (payload.includes("pandora") || payload.startsWith("42") || payload.startsWith("40")) {
    console.error("→", payload.slice(0, 140));
  }
});

view.addEventListener("Network.webSocketFrameReceived", (ev) => {
  const d = (ev as MessageEvent).data as {
    response?: { payloadData?: string };
    requestId?: string;
  };
  const payload = d?.response?.payloadData ?? "";
  frames.push({
    t: Date.now(),
    dir: "recv",
    payload,
    requestId: d?.requestId,
  });
  if (payload.startsWith("42") || payload.startsWith("0{") || payload.startsWith("40")) {
    console.error("←", payload.slice(0, 140));
  }
});

await view.navigate(startUrl);
await Bun.sleep(seconds * 1000);

await Bun.write(outPath, frames.map((f) => JSON.stringify(f)).join("\n") + "\n");

// Summary
const topics = new Set<string>();
for (const f of frames) {
  const p = f.payload ?? "";
  if (!p.startsWith("42")) continue;
  try {
    const m = /^42(\[.*\])$/.exec(p);
    if (!m) continue;
    const arr = JSON.parse(m[1]!) as unknown[];
    topics.add(String(arr[0]));
    if (Array.isArray(arr[1]) && typeof arr[1][0] === "string") {
      topics.add(`room:${arr[1][0]}`);
    }
  } catch {
    /* ignore */
  }
}

const pandora = frames.filter(
  (f) =>
    f.url?.includes("pandora") ||
    f.payload?.includes("setSocketMetadata") ||
    f.payload?.includes("eventCoefficients"),
);

console.log(
  JSON.stringify(
    {
      outPath,
      url: view.url,
      frameCount: frames.length,
      pandoraRelated: pandora.length,
      topics: [...topics].sort(),
      sampleSent: frames
        .filter((f) => f.dir === "sent" && f.payload?.startsWith("42"))
        .slice(0, 25)
        .map((f) => f.payload),
    },
    null,
    2,
  ),
);
