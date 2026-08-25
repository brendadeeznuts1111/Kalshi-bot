/**
 * image-page.ts — /bun/image: the Bun.Image pipeline reference (bun.com/
 * docs/runtime/image), probed against Bun 1.4.0 in AGENT-PITFALLS §70.
 * Token-built audited page.
 */
import { renderWidgetPage, widgetTable, W_VERIFIED, W_CORRECTED } from "../lib/widget-page.ts";

export function renderImagePage(): string {
  const pipeline = widgetTable(["Pipeline", "Probe"], [
    { cells: ["chainable: file().image().resize().webp().write()", W_VERIFIED + " returns bytes written; nothing runs until a terminal (§70)"] },
    { cells: ["terminals: bytes/buffer/blob/toBase64/dataurl/write", W_VERIFIED + " all six verified; blob() sets output MIME (§70)"] },
    { cells: ["metadata() {width,height,format}", W_VERIFIED + " header-only, no pixel decode (§70)"] },
    { cells: ["width/height -1 before terminal, output after", W_VERIFIED + " verified: -1 pre-await, 30x30 post (§70)"] },
    { cells: ["fit inside vs fill", W_VERIFIED + " inside preserves aspect (2:1 in 50x100 -> 50x25); fill stretches exactly (§70)"] },
    { cells: ["modulate(brightness/saturation)", W_VERIFIED + " chains and encodes (§70)"] },
  ]);
  const geometry = widgetTable(["Geometry", "Probe"], [
    { cells: ["rotate(90) alone", W_VERIFIED + " swaps dims (2x1 -> 1x2) (§70)"] },
    { cells: ["rotate/flip/flop AFTER resize", W_CORRECTED + " NO-OP in 1.4.0 — the doc shows resize().rotate() chaining, but the geometry op is silently dropped when resize ran first; apply geometry BEFORE resize (§70)"] },
    { cells: ["flip/flop alone", W_VERIFIED + " available; dims unchanged (§70)"] },
  ]);
  const formats = widgetTable(["Formats + backend", "Probe"], [
    { cells: ["jpeg/png/webp encode", W_VERIFIED + " verified; png {palette}, jpeg {progressive} documented (§70)"] },
    { cells: ["heic/avif encode (macOS arm64)", W_VERIFIED + " both work on this machine — the doc warns platform-dependent (§70)"] },
    { cells: ["placeholder() ThumbHash data: URL", W_VERIFIED + " returns data:image/... ~2.6KB for the probe image (§70)"] },
    { cells: ["Bun.Image.backend", W_VERIFIED + " default system; set <code>\"bun\"</code> forces portable Highway path (§70)"] },
    { cells: ["clipboard statics", W_VERIFIED + " fromClipboard/hasClipboardImage/clipboardChangeCount all exist (§70)"] },
  ]);
  return renderWidgetPage({
    title: "Bun.Image Reference",
    subtitle: "Chainable image pipeline — probed against Bun 1.4.0 (20/20); 1 geometry-ordering correction",
    badges: ["decode · resize · rotate · encode", "terminals", "backend", "probed §70"],
    links: ["/bun/overview", "/bun/markdown", "/bun/streams"],
    sections: [
      { heading: "Pipeline + terminals", html: pipeline },
      { heading: "Geometry (the §70 ordering correction)", html: geometry },
      { heading: "Formats + backend", html: formats },
    ],
    footer: "Full probe matrix: docs/AGENT-PITFALLS.md §70 · page: src/research/image-page.ts",
  });
}