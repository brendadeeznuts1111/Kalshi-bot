#!/usr/bin/env bun
/**
 * Validate official + glossary-linked URLs (HEAD/GET, no body drain).
 * Optional --og: extract Open Graph / Twitter cards via HTMLRewriter.
 *
 * Run: bun run glossary:urls
 * Soft: bun run glossary:urls -- --soft
 * OG sample: bun run glossary:urls -- --og
 *
 * @see https://bun.com/docs/runtime/networking/fetch#sending-an-http-request
 * @see https://bun.com/docs/guides/html-rewriter/extract-social-meta#extract-social-share-images-and-open-graph-tags
 * @see src/institutions/official-urls.ts
 * @see src/lib/extract-social-meta.ts
 */
import { GLOSSARY_ENTRIES } from "../src/institutions/glossary.ts";
import { OFFICIAL_URLS } from "../src/institutions/official-urls.ts";
import { extractSocialMetadataFromResponse } from "../src/lib/extract-social-meta.ts";

const soft = Bun.argv.includes("--soft");
const withOg = Bun.argv.includes("--og");
const timeoutMs = Number(Bun.env.GLOSSARY_URL_TIMEOUT_MS ?? 8_000);

type Check = { label: string; url: string; og?: boolean };

function collectOfficial(): Check[] {
  const out: Check[] = [];
  for (const [cat, urls] of Object.entries(OFFICIAL_URLS)) {
    for (const [key, url] of Object.entries(urls)) {
      if (typeof url === "string" && /^https?:\/\//i.test(url)) {
        // Marketing / docs pages are good OG candidates; skip pure API bases & WSS
        const og =
          withOg &&
          !url.includes("api.") &&
          !url.includes("trade-api") &&
          !url.startsWith("wss:") &&
          (key === "home" ||
            key.includes("Schedule") ||
            key.includes("Docs") ||
            key.includes("guide") ||
            key.includes("Guide") ||
            cat === "github");
        out.push({ label: `official:${cat}.${key}`, url, og });
      }
    }
  }
  return out;
}

function collectGlossary(): Check[] {
  return GLOSSARY_ENTRIES.filter((e) => typeof e.url === "string" && e.url).map((e) => ({
    label: `glossary:${e.id}`,
    url: e.url!,
    og: withOg && /^https?:\/\//i.test(e.url!) && !e.url!.includes("/api-reference/"),
  }));
}

async function probe(
  url: string,
): Promise<{ ok: boolean; status: number; error?: string; res?: Response }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "kalshi-bot-glossary-url-check/1" },
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: ctrl.signal,
        headers: { "user-agent": "kalshi-bot-glossary-url-check/1" },
      });
    }
    return { ok: res.ok || res.status === 429, status: res.status, res };
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
  const result = await probe(item.url);
  if (!result.ok || !item.og) {
    return { ok: result.ok, status: result.status, error: result.error };
  }

  // Need a body for HTMLRewriter — GET if HEAD succeeded without body
  try {
    const res = await fetch(item.url, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": "kalshi-bot-glossary-url-check/1" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return { ok: result.ok, status: res.status, error: `OG GET ${res.status}` };
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html") && !ct.includes("text/")) {
      return { ok: result.ok, status: res.status, ogLine: "(skip OG — non-HTML)" };
    }
    const meta = await extractSocialMetadataFromResponse(res, item.url);
    const bits = [
      meta.title ? `title=${JSON.stringify(meta.title.slice(0, 60))}` : null,
      meta.image ? `image=yes` : "image=no",
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
console.log(`Checking ${checks.length} URL(s)${withOg ? " (+OG sample)" : ""}…`);

let failures = 0;
const CONCURRENCY = 6;
let i = 0;
async function worker() {
  while (i < checks.length) {
    const idx = i++;
    const item = checks[idx]!;
    const result = item.og ? await probeWithOg(item) : await probe(item.url);
    if (result.ok) {
      const og = "ogLine" in result && result.ogLine ? `  ${result.ogLine}` : "";
      console.log(`✅ ${item.label} → ${result.status}${og}`);
    } else {
      failures++;
      console.error(
        `❌ ${item.label} → ${result.status || "ERR"} ${result.error ?? ""} ${item.url}`,
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
console.log(`\n✅ URL check complete (${checks.length - failures}/${checks.length} ok)`);
