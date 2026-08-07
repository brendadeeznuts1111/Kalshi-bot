#!/usr/bin/env bun
/**
 * Capture Pandora Socket.IO frames from the Ultra live widget via Bun.WebView
 * + Chrome CDP (Network.webSocketFrame*).
 *
 * Prefer CDP over page-side WebSocket monkey-patching: the socket opens during
 * page load, so a post-navigate evaluate() patch is too late.
 *
 * @see https://bun.com/docs/runtime/webview#new-bun-webview-options — Bun.WebView
 * @see https://bun.com/docs/runtime/webview#cdp — CDP Network.webSocketFrame*
 *
 * Usage:
 *   bun run partner:webview-ws-capture
 *   bun run partner:webview-ws-capture -- --sport=220 --seconds=25
 *   bun run partner:webview-ws-capture -- --url="$LIVE_DESKTOP_URL" --seconds=30
 *
 * Writes JSONL + summary JSON under research/cache/partner-ws-capture/ (gitignored).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readArtifactIntegrity } from '../src/institutions/event-store/visual-snapshot-meta.ts';
import { redactCaptureUrl } from '../src/partner/webview-ws-capture.ts';
import {
  parseCdpWebSocketClosed,
  parseCdpWebSocketCreated,
  parseCdpWebSocketFrame,
  type CdpWebSocketClosed,
  type CdpWebSocketCreated,
  type CdpWebSocketFrame,
} from '../src/partner/webview-cdp-events.ts';

function argValue(name: string): string | undefined {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const seconds = Math.min(Math.max(Number(argValue('seconds') ?? '25') || 25, 5), 120);
const sport = argValue('sport') ?? '220';
const startUrl = argValue('url') ?? `https://plive.sportswidgets.pro/live/?#!/sport/${sport}`;

const outDir = join(process.cwd(), 'research/cache/partner-ws-capture');
mkdirSync(outDir, { recursive: true });
const stamp = Date.now();
const outPath = join(outDir, `ws-${stamp}.jsonl`);
const summaryPath = join(outDir, `ws-${stamp}-summary.json`);

type Frame = {
  t: number;
  dir: 'sent' | 'recv' | 'created' | 'closed' | 'error';
  url?: string;
  payload?: string;
  requestId?: string;
};

const frames: Frame[] = [];
const requestUrlById = new Map<string, string>();

if (typeof Bun.WebView !== 'function') {
  console.error('Bun.WebView unavailable — need Bun ≥1.4 with WebView');
  process.exit(1);
}

function isPandoraUrl(url: string | undefined): boolean {
  return Boolean(url?.includes('pandora.ganchrow.com'));
}

function looksLikeOdds(payload: string): boolean {
  return (
    payload.includes('eventCoefficients') ||
    payload.includes('"odds"') ||
    payload.includes('"american"') ||
    payload.includes('"price"')
  );
}

/** Socket.IO binary-event placeholder (`451-`); body follows as a separate WS frame. */
function isBinaryPlaceholder(payload: string): boolean {
  return /^451-/.test(payload);
}

/** gzip/base64 attachment bodies that follow `451-` placeholders. */
function isGzipAttachment(payload: string): boolean {
  return payload.startsWith('H4sI');
}

console.error(`webview capture → ${startUrl} for ${seconds}s (chrome CDP Network.webSocket*)`);

await using view = new Bun.WebView({
  // Force spawn (no auto-connect to an interactive Chrome) so CDP events are ours.
  backend: { type: 'chrome', url: false },
  width: 1280,
  height: 800,
  console: (type, ...args) => {
    if (type === 'error' || type === 'warn') {
      console.error(`[page:${type}]`, ...args);
    }
  },
});

// CDP session is established on first navigate.
await view.navigate('about:blank');
await view.cdp('Network.enable', {});

view.addEventListener<CdpWebSocketCreated>('Network.webSocketCreated', ev => {
  const data = parseCdpWebSocketCreated(ev);
  const safeUrl = data?.url ? redactCaptureUrl(data.url) : undefined;
  if (data?.requestId && safeUrl) requestUrlById.set(data.requestId, safeUrl);
  frames.push({
    t: Date.now(),
    dir: 'created',
    url: safeUrl,
    requestId: data?.requestId,
  });
  console.error('WS created', safeUrl?.slice(0, 120) ?? '(no url)');
});

view.addEventListener<CdpWebSocketFrame>('Network.webSocketFrameSent', ev => {
  const data = parseCdpWebSocketFrame(ev);
  const payload = data?.response?.payloadData ?? '';
  const url = data?.requestId ? requestUrlById.get(data.requestId) : undefined;
  frames.push({
    t: Date.now(),
    dir: 'sent',
    payload,
    requestId: data?.requestId,
    url,
  });
  if (
    payload.startsWith('42') ||
    payload.startsWith('40') ||
    payload.includes('setSocketMetadata')
  ) {
    console.error('→', payload.slice(0, 160));
  }
});

view.addEventListener<CdpWebSocketFrame>('Network.webSocketFrameReceived', ev => {
  const data = parseCdpWebSocketFrame(ev);
  const payload = data?.response?.payloadData ?? '';
  const url = data?.requestId ? requestUrlById.get(data.requestId) : undefined;
  frames.push({
    t: Date.now(),
    dir: 'recv',
    payload,
    requestId: data?.requestId,
    url,
  });
  if (
    payload.startsWith('42') ||
    payload.startsWith('0{') ||
    payload.startsWith('40') ||
    looksLikeOdds(payload) ||
    isBinaryPlaceholder(payload)
  ) {
    console.error('←', payload.slice(0, 160));
  } else if (isGzipAttachment(payload) && payload.length > 1000) {
    console.error('← gzip attachment', payload.length, 'bytes', payload.slice(0, 40) + '…');
  }
});

view.addEventListener<CdpWebSocketClosed>('Network.webSocketClosed', ev => {
  const data = parseCdpWebSocketClosed(ev);
  frames.push({
    t: Date.now(),
    dir: 'closed',
    requestId: data?.requestId,
    url: data?.requestId ? requestUrlById.get(data.requestId) : undefined,
  });
});

await view.navigate(startUrl);

// Hash-router SPAs sometimes drop #! on first load — re-assert sport route.
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
} catch (e) {
  console.error('hash assert failed:', e);
}

await Bun.sleep(seconds * 1000);

await Bun.write(outPath, frames.map(f => JSON.stringify(f)).join('\n') + '\n');
const artifact = await readArtifactIntegrity(outPath);
if (!artifact) throw new Error('WebView capture artifact integrity unavailable');
const snapshotMeta = {
  schemaVersion: 1 as const,
  capturedAt: new Date(stamp).toISOString(),
  runtime: { bunVersion: Bun.version, bunRevision: Bun.revision },
  webview: {
    backend: 'chrome' as const,
    width: 1280 as const,
    height: 800 as const,
    cdpNetworkCapture: true as const,
  },
  artifact,
};

const sent42 = frames.filter(f => f.dir === 'sent' && (f.payload?.startsWith('42') ?? false));
const recv42 = frames.filter(f => f.dir === 'recv' && (f.payload?.startsWith('42') ?? false));
const subscribeMsgs = sent42.filter(f => {
  const p = f.payload ?? '';
  return (
    p.includes('setSocketMetadata') ||
    p.includes('subscribeSystemEvents') ||
    p.includes('"subscribe"')
  );
});
const oddsMessages = frames.filter(
  f => f.dir === 'recv' && typeof f.payload === 'string' && looksLikeOdds(f.payload)
);
const binaryPlaceholders = frames.filter(
  f => f.dir === 'recv' && typeof f.payload === 'string' && isBinaryPlaceholder(f.payload)
);
const gzipAttachments = frames.filter(
  f => f.dir === 'recv' && typeof f.payload === 'string' && isGzipAttachment(f.payload)
);
const coeffSubscribes = sent42.filter(f => (f.payload ?? '').includes('eventCoefficients'));

const topics = new Set<string>();
for (const f of sent42) {
  const p = f.payload ?? '';
  try {
    const m = /^42(\[.*\])$/.exec(p);
    if (!m) continue;
    const arr = JSON.parse(m[1]!) as unknown[];
    topics.add(String(arr[0]));
    if (Array.isArray(arr[1]) && typeof arr[1][0] === 'string') {
      topics.add(`room:${arr[1][0]}`);
    }
  } catch {
    /* ignore */
  }
}

const pandoraCreated = frames.filter(f => f.dir === 'created' && isPandoraUrl(f.url));

const summary = {
  outPath,
  summaryPath,
  startUrl: redactCaptureUrl(startUrl),
  finalUrl: redactCaptureUrl(String(view.url ?? startUrl)),
  seconds,
  frameCount: frames.length,
  pandoraSockets: pandoraCreated.map(f => f.url ? redactCaptureUrl(f.url) : undefined),
  snapshotMeta,
  topics: [...topics].sort(),
  /** Primary client emits that start the live book (paste into adapter / probe). */
  subscribeMsg: subscribeMsgs[0]?.payload ?? null,
  subscribeMsgs: subscribeMsgs.slice(0, 40).map(f => f.payload),
  /** Per-event coefficient room subscriptions (priced book). */
  coeffSubscribeMsgs: coeffSubscribes.slice(0, 20).map(f => f.payload),
  /** Server frames naming eventCoefficients rooms. */
  oddsMessages: oddsMessages
    .slice(0, 8)
    .map(f => ((f.payload ?? '').length > 500 ? `${(f.payload ?? '').slice(0, 500)}…` : f.payload)),
  /** Binary attachment placeholders (`451-`). */
  binaryPlaceholders: binaryPlaceholders.slice(0, 12).map(f => f.payload),
  /** Follow-up gzip bodies (base64) — decode next for American prices. */
  gzipAttachmentSizes: gzipAttachments.slice(0, 20).map(f => (f.payload ?? '').length),
  gzipAttachmentSamples: gzipAttachments
    .slice(0, 3)
    .map(f => (f.payload ?? '').slice(0, 120) + '…'),
  sampleSent42: sent42.slice(0, 30).map(f => f.payload),
  sampleRecv42: recv42
    .slice(0, 10)
    .map(f => ((f.payload ?? '').length > 300 ? `${(f.payload ?? '').slice(0, 300)}…` : f.payload)),
};

await Bun.write(summaryPath, JSON.stringify(summary, null, 2) + '\n');

console.log(JSON.stringify(summary, null, 2));

if (!summary.subscribeMsg) {
  console.error(
    '\nNo subscribe emits captured. Try a signed LIVE_DESKTOP_URL from getUltraLiveURL, or increase --seconds.'
  );
  process.exitCode = 2;
}
