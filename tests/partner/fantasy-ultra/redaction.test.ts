// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { FantasyUltraAdapter } from "../../../src/partner/fantasy-ultra/adapter.ts";
import { PandoraSocket } from "../../../src/partner/fantasy-ultra/pandora-socket.ts";

describe("FantasyUltraAdapter inspect.custom", () => {
  test("compact form, token redacted to set/unset", () => {
    const adapter = new FantasyUltraAdapter({
      credentials: {
        domain: "https://example.test",
        bearerToken: "SUPER_SECRET_BEARER",
        password: "pw",
        token: "tok",
        agentID: "a",
        customerID: "c",
      } as never,
      fetchImpl: (() => Promise.resolve(new Response())) as never,
    });
    const out = Bun.inspect(adapter);
    expect(out).toContain("FantasyUltraAdapter(");
    expect(out).toContain("token=set");
    expect(out).not.toContain("SUPER_SECRET_BEARER");
    expect(out).not.toContain("pw");
  });
});

describe("PandoraSocket inspect.custom", () => {
  test("url query params (gsid) never appear", () => {
    const socket = new PandoraSocket({
      url: "wss://pandora.example.test/socket?gsid=SECRET_GSID",
      reconnect: false,
    });
    const out = Bun.inspect(socket);
    expect(out).toContain("PandoraSocket(pandora.example.test");
    expect(out).not.toContain("SECRET_GSID");
    expect(out).not.toContain("gsid");
  });
});
