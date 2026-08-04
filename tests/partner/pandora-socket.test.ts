// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  EIO,
  encodeSocketIoEmit,
  parseEngineOpen,
  parseSocketIoEvent,
  SIO,
} from "../../src/partner/fantasy-ultra/pandora-socket.ts";
import { defaultPandoraSocketUrl } from "../../src/partner/fantasy-ultra/pandora-socket.ts";
import { FANTASY_WIDGET_CONFIG } from "../../src/partner/fantasy-ultra/widget-config.ts";

describe("pandora socket protocol", () => {
  test("default URL matches widget + EIO4 websocket", () => {
    const url = defaultPandoraSocketUrl();
    expect(url.startsWith(FANTASY_WIDGET_CONFIG.customWebSocketUrl)).toBe(true);
    expect(url).toContain("EIO=4");
    expect(url).toContain("transport=websocket");
  });

  test("parseEngineOpen from live-shaped packet", () => {
    const raw =
      '0{"sid":"lC_jOBLDvXtEvRaCAAjp","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}';
    const info = parseEngineOpen(raw);
    expect(info?.sid).toBe("lC_jOBLDvXtEvRaCAAjp");
    expect(info?.pingInterval).toBe(25_000);
  });

  test("parseSocketIoEvent 42 payload", () => {
    const frame = encodeSocketIoEmit("odds", { sport: 220, price: -115 });
    expect(frame.startsWith(EIO.message + SIO.event)).toBe(true);
    const evt = parseSocketIoEvent(frame);
    expect(evt?.eventName).toBe("odds");
    expect((evt?.args[0] as { sport: number }).sport).toBe(220);
  });

  test("non-event packets return null", () => {
    expect(parseSocketIoEvent("2")).toBeNull();
    expect(parseSocketIoEvent('40{"sid":"x"}')).toBeNull();
  });
});
