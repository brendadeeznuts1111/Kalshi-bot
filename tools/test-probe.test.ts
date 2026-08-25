import { afterAll, beforeAll, describe, expect, expectTypeOf, jest, mock, onTestFinished, setDefaultTimeout, setSystemTime, spyOn, test, vi } from "bun:test";

// §137: probe the bun:test runner surface on Bun 1.4.0 — mocks, spies,
// module mocks (repo: github-budget.test.ts pattern), fake timers,
// inline snapshots, test.each/options, expectTypeOf, lifecycle, jest/vi
// compat. This file IS the gate (bun test tools/test-probe.test.ts).

// P5 fixture + module mock — registered top-level before any import of
// the fixture (repo pattern: register in beforeAll, mock by path).
const FIX = "../scratch/test-probe-fixture.ts";
await Bun.write("scratch/test-probe-fixture.ts", 'export const value = "real";\nexport function add(a: number, b: number) { return a + b; }\n');
mock.module(FIX, () => ({ value: "mocked", add: () => 999 }));

test("P1 mock.fn calls/results/lastCall/clear", () => {
  const m = mock((x: number) => x * 2);
  m(5); m(10);
  expect(m).toHaveBeenCalledTimes(2);
  expect(m).toHaveBeenCalledWith(5);
  expect(m.mock.calls).toEqual([[5], [10]]);
  expect(m.mock.results.map((r) => r.value)).toEqual([10, 20]);
  expect(m.mock.lastCall).toEqual([10]);
  m.mockClear();
  expect(m.mock.calls).toEqual([]);
});

test("P2 mockImplementation(Once)/ReturnValue(Once)", () => {
  const m = mock();
  m.mockImplementationOnce(() => "first");
  m.mockImplementation(() => "default");
  expect(m()).toBe("first");
  expect(m()).toBe("default");
  const r = mock();
  r.mockReturnValueOnce("once").mockReturnValue("always");
  expect(r()).toBe("once");
  expect(r()).toBe("always");
});

test("P3 async mocks resolved/rejected", async () => {
  const a = mock();
  a.mockResolvedValueOnce("first").mockResolvedValue("rest");
  expect(await a()).toBe("first");
  expect(await a()).toBe("rest");
  const rej = mock();
  rej.mockRejectedValue(new Error("boom"));
  await expect(rej()).rejects.toThrow("boom");
});

test("P4 spyOn tracks without replacing", () => {
  const obj = { greet: (n: string) => "hi " + n };
  const sp = spyOn(obj, "greet");
  expect(obj.greet("x")).toBe("hi x");
  expect(sp).toHaveBeenCalledWith("x");
  expect(sp.mock.calls).toEqual([["x"]]);
  sp.mockRestore();
  expect(obj.greet("y")).toBe("hi y");
});

test("P5 mock.module intercepts import", async () => {
  const mod: any = await import(FIX);
  expect(mod.value).toBe("mocked");
  expect(mod.add(1, 2)).toBe(999);
});

test("P6 setSystemTime fake clock", () => {
  setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
  expect(Date.now()).toBe(1577836800000);
  expect(new Date().toISOString()).toBe("2020-01-01T00:00:00.000Z");
  expect(typeof (setSystemTime as any).advanceSystemTime === "undefined" || typeof (setSystemTime as any).advanceSystemTime === "function").toBe(true);
});

test("P7 toMatchInlineSnapshot", () => {
  expect("hello").toMatchInlineSnapshot("\"hello\"");
});

test.each([[1, 2, 3], [4, 5, 9]])("P8 each %i + %i = %i", (a: number, b: number, c: number) => {
  expect(a + b).toBe(c);
});

test("P8a retry option accepted", () => {
  expect(1).toBe(1);
}, { retry: 2 });

test("P8b timeout option accepted", () => {
  expect(2).toBe(2);
}, { timeout: 5000 });

test.todo("P8c todo placeholder is not a failure", () => {});

test("P9 expectTypeOf runtime + compat aliases", () => {
  expectTypeOf(1).toEqualTypeOf<number>();
  expect(typeof expectTypeOf).toBe("function");
  expect(typeof jest.fn).toBe("function");
  expect(typeof vi.fn).toBe("function");
});

const order: string[] = [];
beforeAll(() => order.push("beforeAll"));
test("P10 lifecycle hooks fire", () => {
  onTestFinished(() => order.push("onTestFinished"));
  expect(order).toEqual(["beforeAll"]);
});

test("P10a beforeAll ran first", () => {
  expect(order[0]).toBe("beforeAll");
});

test("P11 expect matchers set", () => {
  expect("str").toBeTypeOf("string");
  expect({ a: 1, b: 2 }).toMatchObject({ a: 1 });
  expect(0.1 + 0.2).toBeCloseTo(0.3, 5);
  expect([1, 2]).toContain(2);
  expect("abc").toHaveLength(3);
});


// P12 fake timers: vi.useFakeTimers + advanceTimersByTime + restore
test("P12 vi fake timers advance + restore", () => {
  vi.useFakeTimers();
  expect(vi.isFakeTimers()).toBe(true);
  let fired = false;
  setTimeout(() => { fired = true; }, 1000);
  expect(fired).toBe(false);
  vi.advanceTimersByTime(1000);
  expect(fired).toBe(true);
  vi.useRealTimers();
  expect(vi.isFakeTimers()).toBe(false);
});

// P13 docs claim (§138): useFakeTimers does NOT patch Date/Date.now
// (bun differs from Jest — the Date constructor stays); setSystemTime DOES.
test("P13 useFakeTimers keeps Date; setSystemTime fakes Date.now", () => {
  const OriginalDate = Date;
  vi.useFakeTimers();
  expect(Date).toBe(OriginalDate);
  expect(Date.now).toBe(OriginalDate.now);
  vi.useRealTimers();
  setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
  expect(Date.now()).toBe(1577836800000);
  setSystemTime();
});

// P14 test.failing inverts: a test that throws PASSES the gate.
test.failing("P14 failing test inverts (throws -> passes)", () => {
  throw new Error("expected");
});

// P15 test.if conditional (truthy condition -> runs).
test.if(true)("P15 test.if true condition runs", () => {
  expect(1).toBe(1);
});

// P16 test.concurrent presence + isolated concurrent test.
test.concurrent("P16 concurrent test isolated", async () => {
  await Bun.sleep(10);
  expect(2 + 2).toBe(4);
});

// P17 describe variants + setDefaultTimeout.
test("P17 describe/only/skip + setDefaultTimeout", () => {
  expect(typeof describe.skip).toBe("function");
  expect(typeof describe.only).toBe("function");
  setDefaultTimeout(5000);
  expect(1).toBe(1);
});

// P18 file snapshot (__snapshots__/test-probe.test.ts.snap, committed).
test("P18 toMatchSnapshot file snapshot", () => {
  expect({ deep: { value: 42 }, list: [1, 2, 3] }).toMatchSnapshot();
});

afterAll(() => { setSystemTime(); });
