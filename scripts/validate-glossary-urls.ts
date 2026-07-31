#!/usr/bin/env bun
/**
 * Validate official + glossary-linked URLs (HEAD/GET, no body drain).
 *
 * Run: bun run glossary:urls
 * Soft mode (warn only): bun run glossary:urls -- --soft
 *
 * @see https://bun.com/docs/runtime/networking/fetch#sending-an-http-request
 * @see src/institutions/official-urls.ts
 * @see src/institutions/glossary.ts
 */
import { GLOSSARY_ENTRIES } from "../src/institutions/glossary.ts";
import { OFFICIAL_URLS } from "../src/institutions/official-urls.ts";

const soft = process.argv.includes("--soft");
const timeoutMs = Number(Bun.env.GLOSSARY_URL_TIMEOUT_MS ?? 8_000);

type Check = { label: string; url: string };

function collectOfficial(): Check[] {
  const out: Check[] = [];
  for (const [cat, urls] of Object.entries(OFFICIAL_URLS)) {
    for (const [key, url] of Object.entries(urls)) {
      if (typeof url === "string" && /^https?:\/\//i.test(url)) {
        out.push({ label: `official:${cat}.${key}`, url });
      }
    }
  }
  return out;
}

function collectGlossary(): Check[] {
  return GLOSSARY_ENTRIES.filter((e) => typeof e.url === "string" && e.url)
    .map((e) => ({ label: `glossary:${e.id}`, url: e.url! }));
}

async function probe(url: string): Promise<{ ok: boolean; status: number; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "kalshi-bot-glossary-url-check/1" },
    });
    // Some CDNs reject HEAD — retry GET without reading the body.
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: ctrl.signal,
        headers: { "user-agent": "kalshi-bot-glossary-url-check/1" },
      });
    }
    return { ok: res.ok || res.status === 429, status: res.status };
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

const checks = [...collectOfficial(), ...collectGlossary()];
console.log(`Checking ${checks.length} URL(s)…`);

let failures = 0;
// Bounded concurrency
const CONCURRENCY = 6;
let i = 0;
async function worker() {
  while (i < checks.length) {
    const idx = i++;
    const item = checks[idx]!;
    const result = await probe(item.url);
    if (result.ok) {
      console.log(`✅ ${item.label} → ${result.status}`);
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
