/**
 * plugins-page.ts - /bun/plugins: the Bundler Plugins doc (bun.com/docs/
 * bundler/plugins), probed against Bun 1.4.0 in AGENT-PITFALLS §61.
 * Token-built audited page (tokens only, design:check audited).
 *
 * Verified: plugin() named export = Bun.plugin; default namespace "file";
 * env-plugin virtual modules in Bun.build; void onResolve = default
 * resolution; onStart/onEnd async ordering; defer() once-only; Bun.build
 * THROWS on unresolvable imports.
 *
 * Corrected (doc claims WRONG on 1.4.0): namespace chars restricted to
 * $a-zA-Z0-9_- so the doc's yaml: example THROWS; file:./dep does NOT
 * resolve bare; onStart CAN mutate build.config; node:/bun: imports have
 * ns "file" not "node"/"bun"; bun:sqlite under Bun.build default target
 * THROWS (needs target:"bun"); runtime onResolve/onLoad never fire -
 * only build.module() works (bunfig preload, NOT [runtime] plugins).
 */
import { renderWidgetPage, widgetTable, W_VERIFIED, W_CORRECTED, W_NOTE } from "../lib/widget-page.ts";

export function renderPluginsPage(): string {
  const namespaces = widgetTable(["Claim (doc §namespaces)", "Probe on Bun 1.4.0"], [
    { cells: ["<code>namespace: \"yaml:\"</code> transforms <code>./myfile.yaml</code> into <code>yaml:./myfile.yaml</code>", W_CORRECTED + " THROWS <code>TypeError: namespace can only contain $a-zA-Z0-9_\-</code> - colon is an invalid namespace char (probe §61)"] },
    { cells: ["default namespace is <code>\"file\"</code>", W_VERIFIED + " onResolve({namespace:\"file\"}) sees relative imports; a loader can redirect a <code>file:</code> specifier (§61)"] },
    { cells: ["<code>import m from \"./m.ts\"</code> is the same as <code>import m from \"file:./m.ts\"</code>", W_CORRECTED + " <code>file:./dep</code> does NOT resolve bare - Bun.build THROWS; the file: prefix is internal-only (§61)"] },
    { cells: ["namespaces <code>\"bun\"</code> and <code>\"node\"</code> for bun:*/node:* modules", W_CORRECTED + " node:fs resolves with ns <code>\"file\"</code>; onResolve({namespace:\"node\"}) never fires; bun:sqlite under Bun.build default target THROWS (needs target:\"bun\") (§61)"] },
  ]);
  const hooks = widgetTable(["Hook", "Probe"], [
    { cells: ["<code>onStart</code>", W_VERIFIED + " async awaited before onLoad - but CAN mutate build.config despite the doc Note (§61)"] },
    { cells: ["<code>onResolve</code>", W_VERIFIED + " filter+namespace select; void return = default resolution continues; can redirect to a new path (§61)"] },
    { cells: ["<code>onLoad</code>", W_VERIFIED + " contents/loader swap, e.g. env plugin in Bun.build; receives path/namespace/loader/defer (§61)"] },
    { cells: ["<code>defer()</code>", W_VERIFIED + " waits for other modules; calling it twice THROWS (once-only) - but the doc example needs an onResolve for stats.json or it fails to resolve (§61)"] },
    { cells: ["<code>onEnd</code>", W_VERIFIED + " async awaited before Bun.build resolves; receives BuildOutput with success=false + logs on failure (§61)"] },
    { cells: ["<code>onBeforeParse</code>", W_NOTE + " native-plugin (NAPI) hook - Rust crate path, not probed in-repo (§61)"] },
  ]);
  const runtime = widgetTable(["Runtime claim", "Probe"], [
    { cells: ["plugins extend the RUNTIME too", W_CORRECTED + " onResolve/onLoad do NOT fire for runtime imports in 1.4.0 (catch-all onResolve: FIRED=0 for ./dep and node:fs) - only <code>build.module()</code> creates runtime virtual modules (§61)"] },
    { cells: ["<code>build.module(specifier, cb)</code>", W_VERIFIED + " runtime virtual module: <code>await import(\"hello:world\")</code> works inline, via bunfig <code>preload</code>, or <code>--preload</code> - returns {exports, loader:\"object\"} (§61)"] },
    { cells: ["<code>[runtime] plugins</code> bunfig key", W_CORRECTED + " NOT loaded in 1.4.0 - the correct bunfig key is top-level <code>preload = [\"./plugin.ts\"]</code> (§61)"] },
    { cells: ["<code>import { plugin } from \"bun\"</code>", W_VERIFIED + " named export exists and IS the same function as Bun.plugin (identity === true) (§61)"] },
  ]);
  const failures = widgetTable(["Bun.build failure mode", "Probe"], [
    { cells: ["unresolvable import (e.g. <code>no-such-pkg</code>)", W_CORRECTED + " Bun.build THROWS AggregateError (\"Bundle failed\") rather than returning success:false - and onEnd still fires with success=false + logs (§61)"] },
    { cells: ["<code>bun:sqlite</code> / <code>bun:test</code> under default target", W_CORRECTED + " both throw under Bun.build default target; <code>bun:sqlite</code> builds with target:\"bun\" (consistent with §48/§59 target finding) (§61)"] },
  ]);
  return renderWidgetPage({
    title: "Bundler Plugins Reference",
    subtitle: "bun.com/docs/bundler/plugins (#namespaces anchor) - every claim probed against Bun 1.4.0; 4 doc corrections",
    badges: ["onStart · onResolve · onLoad · defer · onEnd", "namespaces", "runtime vs bundler", "probed §61"],
    links: ["/bun/overview", "/bun/transpiler", "/bun/markdown"],
    sections: [
      { heading: "Namespaces (the #namespaces anchor)", html: namespaces },
      { heading: "Lifecycle hooks", html: hooks },
      { heading: "Runtime vs bundler plugins", html: runtime },
      { heading: "Failure modes", html: failures },
    ],
    footer: "Full probe matrix: docs/AGENT-PITFALLS.md §61 · page: src/research/plugins-page.ts",
  });
}