// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  buildPliveSubscribeSequence,
  defaultPandoraSocketUrl,
  EIO,
  encodeSocketIoEmit,
  parseEngineOpen,
  parseSocketIoEvent,
  SIO,
} from "../../src/partner/fantasy-ultra/pandora-socket.ts";
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

  test("buildPliveSubscribeSequence includes metadata and coefficient rooms", () => {
    const seq = buildPliveSubscribeSequence({ eventIds: [174125551] });
    expect(seq[0]!.eventName).toBe("setSocketMetadata");
    expect(seq.some((s) => s.eventName === "subscribeSystemEvents")).toBe(true);
    const rooms = seq
      .filter((s) => s.eventName === "subscribe")
      .flatMap((s) => (s.args[0] as string[]) ?? []);
    expect(rooms.some((r) => r.includes("eventCoefficients.174125551"))).toBe(
      true,
    );
    expect(rooms).toContain("live.sports");
  });
});
