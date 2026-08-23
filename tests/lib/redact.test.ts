// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test, expectTypeOf } from "bun:test";
import { redactSecrets, redactUrlParams, type RedactedClone, type RedactedMarker } from "../../src/lib/redact.ts";
import { PandoraSocket } from "../../src/partner/fantasy-ultra/pandora-socket.ts";

type Input = { id: number; password: string; meta: { apiToken: string } };

describe("RedactedClone type", () => {
  test("secret keys become the marker type, others keep shape", () => {
    type Out = RedactedClone<Input>;
    type Assert<T extends true> = T;
    const _id: Assert<Out["id"] extends number ? true : false> = true;
    const _pw: Assert<Out["password"] extends RedactedMarker ? true : false> = true;
    const _tok: Assert<Out["meta"]["apiToken"] extends RedactedMarker ? true : false> = true;
    expect([_id, _pw, _tok]).toEqual([true, true, true]);
  });
});

describe("redactSecrets depth", () => {
  test("depth bounds recursion", () => {
    const deep = { a: { b: { c: { d: 1 } } } };
    const out = redactSecrets(deep, { depth: 2 }) as Record<string, unknown>;
    expect(out.a).toBeDefined();
    expect((out.a as Record<string, unknown>).b).toBe("[DepthLimit]");
  });
});

describe("redactUrlParams", () => {
  test("redacts secret query keys, keeps others", () => {
    expect(redactUrlParams("wss://h/path?gsid=SECRET&lang=en")).toBe("wss://h/path?gsid=%F0%9F%94%92+REDACTED&lang=en");
    expect(redactUrlParams("wss://h/path?gsid=SECRET")).toContain("REDACTED");
    expect(redactUrlParams("wss://h/path?gsid=SECRET")).not.toContain("SECRET");
  });

  test("redactAll stubs every query param", () => {
    expect(redactUrlParams("https://h/x?a=1&b=2", { redactAll: true })).toContain("REDACTED");
  });

  test("invalid URL returns as-is", () => {
    expect(redactUrlParams("not a url")).toBe("not a url");
  });
});

describe("PandoraSocket display", () => {
  test("gsid redacted in inspect output", () => {
    const socket = new PandoraSocket({ url: "wss://pandora.example.test/socket?gsid=SECRET_GSID" });
    const out = Bun.inspect(socket);
    expect(out).toContain("pandora.example.test");
    expect(out).not.toContain("SECRET_GSID");
  });
});
