#!/usr/bin/env bun
/**
 * Validate official + glossary-linked URLs (HEAD/GET, no body drain).
 * Optional --og: extract Open Graph / Twitter cards via HTMLRewriter.
 * Optional --json: machine UrlHealthReport (no OG).
 *
 * Run: bun run glossary:urls
 * Soft: bun run glossary:urls -- --soft
 * OG sample: bun run glossary:urls -- --soft --og
 * JSON: bun run glossary:urls -- --json
 *
 * @see https://bun.com/docs/runtime/networking/fetch#sending-an-http-request
 * @see https://bun.com/docs/guides/html-rewriter/extract-social-meta#extract-social-share-images-and-open-graph-tags
 * @see src/institutions/url-health.ts
 * @see src/lib/extract-social-meta.ts
 */
import { probeOfficialCatalog } from "../src/institutions/url-health.ts";
import { extractSocialMetadataFromResponse } from "../src/lib/extract-social-meta.ts";

const soft = Bun.argv.includes("--soft");
const withOg = Bun.argv.includes("--og");
const asJson = Bun.argv.includes("--json");
const timeoutMs = Number(Bun.env.GLOSSARY_URL_TIMEOUT_MS ?? 8_000);

// ── JSON path (shared health engine) ───────────────────────────
if (asJson) {
  const report = await probeOfficialCatalog({
    timeoutMs,
    includeGlossary: true,
  });
  console.log(JSON.stringify(report, null, 2)); // console-ok — --json machine output
  if (!report.ok && !soft) process.exit(1);
  process.exit(0);
}

// ── Human / OG path ────────────────────────────────────────────
const report = await probeOfficialCatalog({
  timeoutMs,
  includeGlossary: true,
});

console.log(
  `Checking ${report.checked} URL(s)${withOg ? " (+OG sample)" : ""} · skip ${report.skipped}…`,
);

for (const row of report.rows) {
  if (row.skipped) {
    console.log(`⏭  ${row.label} — ${row.skipReason}`);
    continue;
  }
  if (row.ok) {
    let og = "";
    if (withOg && !row.probeUrl.includes("trade-api") && !row.probeUrl.includes("gamma-api")) {
      const isDoc =
        row.label.includes(".home") ||
        row.label.includes("Docs") ||
        row.label.includes("guide") ||
        row.label.includes("Guide") ||
        row.label.includes("tradeApiDocs") ||
        row.label.startsWith("glossary:") ||
        row.label.includes("github.") ||
        row.label.includes("bun.");
      if (isDoc) {
        try {
          const res = await fetch(row.catalogUrl, {
            headers: { "user-agent": "kalshi-bot-glossary-url-check/1" },
            signal: AbortSignal.timeout(timeoutMs),
          });
          const ct = res.headers.get("content-type") ?? "";
          if (res.ok && (ct.includes("html") || ct.includes("text/"))) {
            const meta = await extractSocialMetadataFromResponse(res, row.catalogUrl);
            const bits = [
              meta.title ? `title=${JSON.stringify(meta.title.slice(0, 60))}` : null,
              meta.image ? "image=yes" : "image=no",
              meta.description ? "desc=yes" : null,
            ].filter(Boolean);
            og = bits.length ? `  ${bits.join(" · ")}` : "  (no OG/twitter tags)";
          }
        } catch {
          og = "  (OG extract failed)";
        }
      }
    }
    const probeNote =
      row.probeUrl !== row.catalogUrl
        ? `  probe=…${row.probeUrl.slice(row.catalogUrl.length)}`
        : "";
    console.log(
      `✅ ${row.label} → ${row.status} ${row.latencyMs}ms${og}${probeNote}`,
    );
  } else {
    console.error(
      `❌ ${row.label} → ${row.status || "ERR"} ${row.error ?? ""} ${row.probeUrl}`,
    );
  }
}

if (report.failed) {
  console.error(`\n${report.failed} URL failure(s)`);
  if (!soft) process.exit(1);
  console.error("(soft mode — exit 0)");
}
console.log(
  `\n✅ URL check complete (${report.checked - report.failed}/${report.checked} ok)`,
);
