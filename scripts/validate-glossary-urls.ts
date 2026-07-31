#!/usr/bin/env bun
/**
 * Validate official + glossary-linked URLs (HEAD/GET, no body drain).
 * Optional --og: extract Open Graph / Twitter cards via HTMLRewriter.
 *
 * Run: bun run glossary:urls
 * Soft: bun run glossary:urls -- --soft
 * OG sample: bun run glossary:urls -- --soft --og
 *
 * API bases use OFFICIAL_URL_PROBES (bare roots often 404).
 *
 * @see https://bun.com/docs/runtime/networking/fetch#sending-an-http-request
 * @see https://bun.com/docs/guides/html-rewriter/extract-social-meta#extract-social-share-images-and-open-graph-tags
 * @see src/institutions/official-urls.ts
 * @see src/lib/extract-social-meta.ts
 */
import { GLOSSARY_ENTRIES } from "../src/institutions/glossary.ts";
import {
  OFFICIAL_URLS,
  resolveProbeUrl,
} from "../src/institutions/official-urls.ts";
import { extractSocialMetadataFromResponse } from "../src/lib/extract-social-meta.ts";

const soft = Bun.argv.includes("--soft");
const withOg = Bun.argv.includes("--og");
const timeoutMs = Number(Bun.env.GLOSSARY_URL_TIMEOUT_MS ?? 8_000);

type Check = {
  label: string;
  /** Catalog / display URL */
  url: string;
  /** Actual HTTP target (may include probe path) */
  probeUrl: string;
  okStatuses: readonly number[];
  og?: boolean;
  skipped?: boolean;
  skipReason?: string;
};

function collectOfficial(): Check[] {
  const out: Check[] = [];
  for (const [cat, urls] of Object.entries(OFFICIAL_URLS)) {
    for (const [key, url] of Object.entries(urls)) {
      if (typeof url !== "string" || !/^https?:\/\//i.test(url) && !url.startsWith("wss:")) {
        continue;
      }
      if (url.startsWith("wss:") || url.startsWith("ws:")) {
        out.push({
          label: `official:${cat}.${key}`,
          url,
          probeUrl: url,
          okStatuses: [],
          skipped: true,
          skipReason: "websocket — no HTTP probe",
        });
        continue;
      }
      const resolved = resolveProbeUrl(cat, key, url);
      if (!resolved) {
        out.push({
          label: `official:${cat}.${key}`,
          url,
          probeUrl: url,
          okStatuses: [],
          skipped: true,
          skipReason: "probe skipped",
        });
        continue;
      }
      const og =
        withOg &&
        !url.includes("trade-api") &&
        !url.includes("gamma-api") &&
        !url.includes("api.the-odds") &&
        (key === "home" ||
          key.includes("Schedule") ||
          key.includes("Docs") ||
          key.includes("guide") ||
          key.includes("Guide") ||
          key === "tradeApiDocs" ||
          key === "color" ||
          key === "env" ||
          cat === "github" ||
          cat === "bun");
      out.push({
        label: `official:${cat}.${key}`,
        url,
        probeUrl: resolved.url,
        okStatuses: resolved.okStatuses,
        og,
      });
    }
  }
  return out;
}

function collectGlossary(): Check[] {
  return GLOSSARY_ENTRIES.filter((e) => typeof e.url === "string" && e.url).map((e) => ({
    label: `glossary:${e.id}`,
    url: e.url!,
    probeUrl: e.url!,
    okStatuses: [200, 204, 301, 302, 304, 429] as const,
    og: withOg && /^https?:\/\//i.test(e.url!) && !e.url!.includes("/api-reference/"),
  }));
}

function statusOk(status: number, okStatuses: readonly number[]): boolean {
  if (okStatuses.includes(status)) return true;
  // Default success class
  return status >= 200 && status < 400;
}

async function probe(
  url: string,
  okStatuses: readonly number[],
): Promise<{ ok: boolean; status: number; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "kalshi-bot-glossary-url-check/1" },
    });
    // Many APIs reject HEAD (404/405/501) but answer GET on the same path.
    if (
      res.status === 404 ||
      res.status === 405 ||
      res.status === 501 ||
      !statusOk(res.status, okStatuses)
    ) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: ctrl.signal,
        headers: { "user-agent": "kalshi-bot-glossary-url-check/1" },
      });
    }
    return {
      ok: statusOk(res.status, okStatuses) || res.status === 429,
      status: res.status,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeWithOg(
  item: Check,
): Promise<{ ok: boolean; status: number; error?: string; ogLine?: string }> {
  const result = await probe(item.probeUrl, item.okStatuses);
  if (!result.ok || !item.og) {
    return { ok: result.ok, status: result.status, error: result.error };
  }

  try {
    const res = await fetch(item.url, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": "kalshi-bot-glossary-url-check/1" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok && res.status !== 429) {
      return { ok: result.ok, status: res.status, ogLine: `(OG GET ${res.status})` };
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html") && !ct.includes("text/")) {
      return { ok: result.ok, status: res.status, ogLine: "(skip OG — non-HTML)" };
    }
    const meta = await extractSocialMetadataFromResponse(res, item.url);
    const bits = [
      meta.title ? `title=${JSON.stringify(meta.title.slice(0, 60))}` : null,
      meta.image ? "image=yes" : "image=no",
      meta.description ? "desc=yes" : null,
    ].filter(Boolean);
    return {
      ok: result.ok,
      status: res.status,
      ogLine: bits.join(" · ") || "(no OG/twitter tags)",
    };
  } catch (err) {
    return {
      ok: result.ok,
      status: result.status,
      error: err instanceof Error ? err.message : String(err),
      ogLine: "(OG extract failed)",
    };
  }
}

const checks = [...collectOfficial(), ...collectGlossary()];
const skipped = checks.filter((c) => c.skipped).length;
console.log(
  `Checking ${checks.length - skipped} URL(s)${withOg ? " (+OG)" : ""} · skip ${skipped}…`,
);

let failures = 0;
const CONCURRENCY = 6;
let i = 0;
async function worker() {
  while (i < checks.length) {
    const idx = i++;
    const item = checks[idx]!;
    if (item.skipped) {
      console.log(`⏭  ${item.label} — ${item.skipReason}`);
      continue;
    }
    const result = item.og
      ? await probeWithOg(item)
      : await probe(item.probeUrl, item.okStatuses);
    const probeNote =
      item.probeUrl !== item.url ? `  probe=${item.probeUrl.replace(item.url, "…")}` : "";
    if (result.ok) {
      const og = result.ogLine ? `  ${result.ogLine}` : "";
      console.log(`✅ ${item.label} → ${result.status}${og}${probeNote}`);
    } else {
      failures++;
      console.error(
        `❌ ${item.label} → ${result.status || "ERR"} ${result.error ?? ""} ${item.probeUrl}`,
      );
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

if (failures) {
  console.error(`\n${failures} URL failure(s)`);
  if (!soft) process.exit(1);
  console.error("(soft mode — exit 0)");
}
console.log(
  `\n✅ URL check complete (${checks.length - skipped - failures}/${checks.length - skipped} ok)`,
);
