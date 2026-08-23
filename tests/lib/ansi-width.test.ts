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
});
