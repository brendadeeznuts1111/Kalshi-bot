import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mock, spyOn } from "bun:test";

// Probe-locked Symbol.dispose / using behavior on Bun 1.4.0 — see docs/BUN_DISPOSE.md.

describe("Symbol.dispose / using (Bun 1.4.0)", () => {
  test("disposal globals exist", () => {
    expect(typeof Symbol.dispose).toBe("symbol");
    expect(typeof Symbol.asyncDispose).toBe("symbol");
    expect(typeof (globalThis as any).DisposableStack).toBe("function");
    expect(typeof (globalThis as any).AsyncDisposableStack).toBe("function");
    expect(typeof (globalThis as any).SuppressedError).toBe("function");
  });

  test("using runs [Symbol.dispose] at scope exit", () => {
    const order: string[] = [];
    {
      using r = { [Symbol.dispose]() { order.push("disposed"); } };
      order.push("in-scope");
    }
    expect(order).toEqual(["in-scope", "disposed"]);
  });

  test("await using runs [Symbol.asyncDispose]", async () => {
    const order: string[] = [];
    await (async () => {
      await using r = { [Symbol.asyncDispose]() { order.push("async-disposed"); return Promise.resolve(); } };
      order.push("in-scope");
    })();
    expect(order).toEqual(["in-scope", "async-disposed"]);
  });

  test("DisposableStack disposes in LIFO order", () => {
    const ev: string[] = [];
    {
      using stack = new DisposableStack();
      stack.use({ [Symbol.dispose]() { ev.push("a"); } });
      stack.use({ [Symbol.dispose]() { ev.push("b"); } });
      stack.defer(() => ev.push("d"));
    }
    expect(ev).toEqual(["d", "b", "a"]);
  });

  test("Bun.serve stops automatically at scope exit", async () => {
    let port = 0;
    {
      using server = Bun.serve({ port: 0, fetch: () => new Response("hi") } as any);
      port = (server as any).port;
      expect(await (await fetch("http://127.0.0.1:" + port)).text()).toBe("hi");
    }
    await expect(fetch("http://127.0.0.1:" + port)).rejects.toThrow();
  });

  test("bun:sqlite Database closes via dispose", () => {
    let dbRef: any;
    {
      using db = new Database(":memory:");
      dbRef = db;
      db.run("CREATE TABLE t (a)");
      db.run("INSERT INTO t VALUES (1)");
    }
    expect(() => dbRef.run("SELECT 1")).toThrow();
  });

  test("prepared statements finalize via dispose", () => {
    let stmtRef: any;
    {
      const db = new Database(":memory:");
      using stmt = db.prepare("SELECT 1");
      stmtRef = stmt;
      expect(stmtRef.get()).toEqual({ "1": 1 });
    }
    expect(() => stmtRef.run()).toThrow();
  });

  test("mock() restores via dispose", () => {
    let mRef: any;
    {
      using m = mock(() => 42);
      mRef = m;
      expect(m()).toBe(42);
    }
    expect(mRef()).toBeUndefined();
  });

  test("spyOn() restores the original via dispose", () => {
    const obj = { method() { return 1; } };
    {
      using sp = spyOn(obj, "method");
      sp.mockImplementation(() => 99);
      // Precondition check (not a tautology): proves the spy is ACTIVE inside
      // the block, so the post-block assertion genuinely verifies restoration.
      expect(obj.method()).toBe(99);
    }
    expect(obj.method()).toBe(1);
  });

  test("claim that does NOT hold: Bun.spawn is not disposable", () => {
    const proc: any = Bun.spawn(["sleep", "0.01"]);
    expect(typeof proc[Symbol.dispose]).toBe("undefined");
    proc.kill();
  });

  test("claim that does NOT hold: Database.reserve is a phantom API", () => {
    const db = new Database(":memory:");
    expect(typeof (db as any).reserve).toBe("undefined");
    db.close();
  });
});
