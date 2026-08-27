#!/usr/bin/env bun
/**
 * `bun run ansi:probe` — ANSI/text cluster (§132): color, inspect,
 * escapeHTML, stringWidth, stripANSI, sliceAnsi, wrapAnsi. Shapes the
 * repo relies on (Bun.color(hex,"css"/"ansi"/"ansi-16m"), Bun.inspect
 * {colors,depth,sorted}). Verified on Bun 1.4.0 (34cbb9a40).
 */
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

const esc = (s: unknown) => JSON.stringify(s);
// color.mdx: css returns the MOST COMPACT form (named color when one
// exists); ansi AUTO-DETECTS terminal depth from stdout ENV VARS (docs
// "Format colors as ANSI", §235): NO_COLOR silences; FORCE_COLOR 1|2|3
// selects 16/256/16m (overrides even TERM=dumb); TERM/COLORTERM alone no
// effect when piped; RGB-array input accepted — use ansi-16m/ansi-256/
// ansi-16 to target a specific depth explicitly.
check("P1 color css compact named form", Bun.color("#ff0000", "css") === "red" && Bun.color("rgb(255, 0, 0)", "css") === "red", esc(Bun.color("#ff0000", "css")));
const ansi16m = Bun.color("#ff0000", "ansi-16m");
check("P2 color ansi-16m truecolor", typeof ansi16m === "string" && ansi16m === "\u001b[38;2;255;0;0m", esc(ansi16m));
const ansi256 = Bun.color("#ff0000", "ansi-256");
check("P3 color ansi-256", ansi256 === "\u001b[38;5;196m", esc(ansi256));
check("P3a color ansi-16", Bun.color("#ff0000", "ansi-16") === "\u001b[91m", esc(Bun.color("#ff0000", "ansi-16")));
check("P3b color number/hex/HEX/rgba", Bun.color("red", "number") === 16711680 && Bun.color("red", "hex") === "#ff0000" && Bun.color("red", "HEX") === "#FF0000" && JSON.stringify(Bun.color("red", "{rgba}")) === JSON.stringify({ r: 255, g: 0, b: 0, a: 1 }), "");
check("P4 color invalid -> null", Bun.color("not-a-color", "css") === null, esc(Bun.color("not-a-color", "css")));

const insp = Bun.inspect({ a: 1, b: [1, 2] });
check("P5 inspect basic", typeof insp === "string" && insp.includes("a") && insp.includes("1"), esc(insp));
const inspC = Bun.inspect("x", { colors: true });
check("P5a inspect colors option", inspC.includes("\x1b["), esc(inspC));
const inspD = Bun.inspect({ a: { b: { c: { d: 1 } } } }, { depth: 2 });
check("P5b inspect depth option", inspD.includes("..."), esc(inspD));
const inspS = Bun.inspect({ b: 1, a: 2 }, { sorted: true });
check("P5c inspect sorted option", inspS.indexOf("a") < inspS.indexOf("b"), esc(inspS));

check("P6 escapeHTML", Bun.escapeHTML("<a href=\"x\">a&b</a>") === "&lt;a href=&quot;x&quot;&gt;a&amp;b&lt;/a&gt;", esc(Bun.escapeHTML("<a href=\"x\">a&b</a>")));

check("P7 stringWidth ascii", Bun.stringWidth("abc") === 3, String(Bun.stringWidth("abc")));
check("P7a stringWidth CJK", Bun.stringWidth("日本語") === 6, String(Bun.stringWidth("日本語")));
check("P7b stringWidth strips ANSI", Bun.stringWidth("\x1b[31mab\x1b[0m") === 2, String(Bun.stringWidth("\x1b[31mab\x1b[0m")));

check("P8 stripANSI", Bun.stripANSI("\x1b[31mred\x1b[0m") === "red", esc(Bun.stripANSI("\x1b[31mred\x1b[0m")));

const sliced = Bun.sliceAnsi("\x1b[31mhello\x1b[0m world", 2, 7);
check("P9 sliceAnsi", typeof sliced === "string" && sliced.length > 0, esc(sliced));

const wrapped = Bun.wrapAnsi("one two three four five", 10);
check("P10 wrapAnsi", typeof wrapped === "string" && wrapped.includes("\n"), esc(wrapped));

// P11: 'ansi' AUTO-PICKS depth from ENV VARS — docs "Format colors as ANSI"
// ("detects the color depth of stdout from environment variables"). §235
// probe: NO_COLOR silences (unless FORCE_COLOR); FORCE_COLOR 1|2|3 selects
// 16/256/16m (overrides TERM=dumb); TERM selects depth even when PIPED
// (xterm→16, xterm-256color→256, dumb→""); COLORTERM=truecolor upgrades to
// 16m. Subprocess probes (env is per-process; base env clears the sandbox's
// NO_COLOR=1/TERM=dumb so each var is tested in isolation).
const ansiDepth = (env: Record<string, string>): string => {
  const childEnv: Record<string, string> = { NO_COLOR: "", TERM: "xterm" };
  for (const [k, v] of Object.entries(env)) childEnv[k] = v;
  const r = Bun.spawnSync([process.execPath, "-e", 'process.stdout.write(Bun.color([255, 165, 0], "ansi"))'], { env: childEnv });
  return (r.stdout?.toString() ?? "");
};
check("P11 ansi auto-picks 16 (FORCE_COLOR=1)", ansiDepth({ FORCE_COLOR: "1" }) === "\u001b[91m", esc(ansiDepth({ FORCE_COLOR: "1" })));
check("P11a ansi auto-picks 256 (FORCE_COLOR=2)", ansiDepth({ FORCE_COLOR: "2" }) === "\u001b[38;5;214m", esc(ansiDepth({ FORCE_COLOR: "2" })));
check("P11b ansi auto-picks 16m (FORCE_COLOR=3)", ansiDepth({ FORCE_COLOR: "3" }) === "\u001b[38;2;255;165;0m", esc(ansiDepth({ FORCE_COLOR: "3" })));
check("P11c ansi NO_COLOR silences (auto)", ansiDepth({ NO_COLOR: "1" }) === "", esc(ansiDepth({ NO_COLOR: "1" })));
check("P11d TERM=dumb silences", ansiDepth({ TERM: "dumb" }) === "", esc(ansiDepth({ TERM: "dumb" })));
check("P11e TERM=xterm-256color selects 256 even PIPED", ansiDepth({ TERM: "xterm-256color" }) === "\u001b[38;5;214m", esc(ansiDepth({ TERM: "xterm-256color" })));
check("P11f COLORTERM=truecolor upgrades to 16m", ansiDepth({ TERM: "xterm-256color", COLORTERM: "truecolor" }) === "\u001b[38;2;255;165;0m", esc(ansiDepth({ TERM: "xterm-256color", COLORTERM: "truecolor" })));
check("P11g FORCE_COLOR overrides TERM=dumb", ansiDepth({ TERM: "dumb", FORCE_COLOR: "2" }) === "\u001b[38;5;214m", esc(ansiDepth({ TERM: "dumb", FORCE_COLOR: "2" })));
check("P11h RGB-array input equals hex input", (() => {
  const r = Bun.spawnSync([process.execPath, "-e", 'process.stdout.write(String(Bun.color([255,165,0], "ansi") === Bun.color("#ffa500", "ansi")))'], { env: { NO_COLOR: "", TERM: "xterm", FORCE_COLOR: "3" } });
  return (r.stdout?.toString() ?? "").trim() === "true";
})(), "");

const failed = results.filter((r) => !r.pass);
console.log("ansi:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
