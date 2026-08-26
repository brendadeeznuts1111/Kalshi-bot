/**
 * Bun.inspect + Bun.inspect.table coverage (IN-table, IN-tableProps, IN-tableColors,
 * IN-tableShapes, IN-options, IN-custom) on 1.4.0 (§9 rows).
 */
import { describe, expect, test } from "bun:test";

describe("Bun.inspect", () => {
  test("surface: function + namespace with table + custom (IN-table)", () => {
    expect(typeof Bun.inspect).toBe("function");
    expect(typeof Bun.inspect.table).toBe("function");
    expect(typeof Bun.inspect.custom).toBe("symbol");
    expect(String(Bun.inspect.custom)).toBe("Symbol(nodejs.util.inspect.custom)");
  });

  test("inspect.table renders aligned box table with index column (IN-table)", () => {
    const rows = [{ name: "alice", age: 30, team: "red" }, { name: "bob", age: 25, team: "blue" }];
    const t = Bun.inspect.table(rows);
    expect(t.startsWith("┌")).toBe(true);
    expect(t).toContain("alice");
    expect(t).toContain("age");
    expect(t).toContain("│ 0 │");
    expect(t.trimEnd().endsWith("┘")).toBe(true);
  });

  test("properties filter limits columns; missing keys render blank (IN-tableProps)", () => {
    const rows = [{ name: "alice", age: 30, team: "red" }, { name: "bob", age: 25, team: "blue" }];
    const t = Bun.inspect.table(rows, ["name", "nope", "team"]);
    expect(t).toContain("name");
    expect(t).toContain("team");
    expect(t).not.toContain("age");
    expect(t).toContain("nope"); // header still shown, cells blank
  });

  test("colors option emits ANSI; works with properties too (IN-tableColors)", () => {
    const rows = [{ name: "alice", age: 30 }];
    expect(Bun.inspect.table(rows, { colors: true })).toContain("\u001b[");
    expect(Bun.inspect.table(rows, ["age"], { colors: true })).toContain("\u001b[33m"); // yellow number
    expect(Bun.inspect.table(rows, { colors: false })).not.toContain("\u001b[");
  });

  test("table shapes: object-of-objects, primitive arrays, mixed, empty (IN-tableShapes)", () => {
    expect(Bun.inspect.table({ a: { x: 1, y: 2 }, b: { x: 3, y: 4 } })).toContain("│ a │");
    expect(Bun.inspect.table(["alpha", "beta"])).toContain("Values");
    expect(Bun.inspect.table([1, "x", true, null, { k: 1 }])).toContain("Values");
    expect(Bun.inspect.table([]).trim()).toContain("└───┘"); // minimal empty box
  });

  test("BunInspectOptions: depth/sorted/compact/colors all honored (IN-options)", () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    expect(Bun.inspect(deep, { depth: 2 })).toContain("[Object ...]");
    expect(Bun.inspect(deep)).not.toContain("[Object ...]");
    expect(Bun.inspect({ z: 1, a: 2 }, { sorted: true })).toBe("{\n  a: 2,\n  z: 1,\n}");
    expect(Bun.inspect({ z: 1, a: 2 }, { sorted: false })).toBe("{\n  z: 1,\n  a: 2,\n}");
    expect(Bun.inspect({ a: [1, 2], b: { c: 3 } }, { compact: true })).toContain("{ a: [ 1, 2 ], b: { c: 3 } }");
    expect(Bun.inspect({ a: 1 }, { colors: true })).toContain("\u001b[");
  });

  test("custom inspect: plain inspect calls it, table does not (IN-custom)", () => {
    const obj: any = { a: 1 };
    obj[Symbol.for("nodejs.util.inspect.custom")] = () => "CUSTOM-VALUE";
    expect(Bun.inspect(obj)).toBe("CUSTOM-VALUE");
    const t = Bun.inspect.table([obj]);
    expect(t).not.toContain("CUSTOM-VALUE");
    expect(t).toContain("nodejs.util.inspect.custom"); // symbol surfaces as a column
  });
});
