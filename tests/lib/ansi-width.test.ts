import { describe, expect, test } from "bun:test";
import { padAnsi, sliceAnsiSafe, visibleWidth } from "../../src/lib/ansi-width.ts";

const GREEN = "\u001b[38;2;204;230;77m";
const RESET = "\u001b[0m";
const spen = GREEN + "SPEN" + RESET;

describe("ANSI-aware width (Bun.stringWidth / sliceAnsi)", () => {
  test("visibleWidth ignores ANSI escapes", () => {
    expect(visibleWidth("SPEN")).toBe(4);
    expect(visibleWidth(spen)).toBe(4);
  });

  test("padAnsi pads to the VISIBLE width", () => {
    const padded = padAnsi(spen, 10);
    expect(padded).toBe(spen + " ".repeat(6));
    expect(visibleWidth(padded)).toBe(10);
    // JS padEnd would have counted the ANSI bytes and padded too little:
    expect(spen.length).toBeGreaterThan(4);
    expect(visibleWidth(padded)).not.toBe(padded.length);
  });

  test("padAnsi left-pads and truncates-never", () => {
    expect(visibleWidth(padAnsi(spen, 2, "left"))).toBe(4); // wider content: unchanged
    const left = padAnsi(spen, 8, "left");
    expect(left.startsWith(" ".repeat(4))).toBe(true);
    expect(visibleWidth(left)).toBe(8);
  });

  test("sliceAnsiSafe keeps ANSI intact around visible cells", () => {
    const sliced = sliceAnsiSafe(spen, 0, 2);
    expect(sliced.includes("38;2")).toBe(true);
    expect(visibleWidth(sliced)).toBe(2);
  });

  test("sliceAnsiSafe supports placeholder and negative start (blog-verified)", () => {
    expect(sliceAnsiSafe("unicorn", 0, 4, "…")).toBe("uni…");
    expect(sliceAnsiSafe("unicorn", -4, undefined, "…")).toBe("…orn");
  });

  // Grapheme pinning (pitfalls 28): escaped \u{...} input on purpose -
  // literal emoji in test sources double-encode in some toolchains and
  // produced a FALSE 'stringWidth returns 8 for a ZWJ family' probe result.
  test("visibleWidth handles multi-codepoint emoji graphemes (escaped input)", () => {
    const zwjFamily = "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}"; // family
    const skinTone = "\u{1F44D}\u{1F3FB}"; // thumbs-up light
    const flag = "\u{1F1FA}\u{1F1F8}"; // US flag
    const keycap = "1\u{FE0F}\u{20E3}";
    const combining = "e\u{0301}";
    expect(visibleWidth(zwjFamily)).toBe(2);
    expect(visibleWidth(skinTone)).toBe(2);
    expect(visibleWidth(flag)).toBe(2);
    expect(visibleWidth(keycap)).toBe(2);
    expect(visibleWidth(combining)).toBe(1);
  });

  test("sliceAnsi keeps hyperlinks and ZWJ families whole (pitfalls 28)", () => {
    const link = "\u001b]8;;http://x.com\u0007hi\u001b]8;;\u0007";
    expect(sliceAnsiSafe(link, 0, 1)).toContain("]8;;http://x.com"); // hyperlink preserved
    const zwjFamily = "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}";
    const sliced = sliceAnsiSafe(zwjFamily, 0, 1);
    expect(visibleWidth(sliced)).toBe(2); // family kept whole, not half-split
  });
});
