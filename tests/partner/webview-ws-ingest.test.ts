// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  ingestWebViewWsFrames,
  type WebViewWsFrame,
} from "../../src/partner/webview-ws-ingest.ts";

function gzipB64CoeffBody(eventId: number): string {
  const json = JSON.stringify({
    isDiff: false,
    payload: {
      id: eventId,
      c: { m: { "3": { o: { "1": 1.91, "2": 1.95 } } } },
    },
  });
  const bytes = Bun.gzipSync(new TextEncoder().encode(json));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

describe("webview ws ingest", () => {
  test("pairs 451- header with gzip body into priced lines", () => {
    const body = gzipB64CoeffBody(99);
    expect(body.startsWith("H4sI")).toBe(true);

    const frames: WebViewWsFrame[] = [
      {
        dir: "recv",
        payload:
          '451-["live.main.TOKEN.eventCoefficients.99",{"_placeholder":true,"num":0}]',
      },
      { dir: "recv", payload: body },
    ];

    const { store, report } = ingestWebViewWsFrames(frames);
    expect(report.binaryHeaders).toBe(1);
    expect(report.gzipBodies).toBe(1);
    expect(report.pricedEvents).toBe(1);
    expect(report.pricedLines).toBe(2);
    const markets = store.toPartnerMarkets();
    expect(markets).toHaveLength(1);
    expect(markets[0]?.homePrice).not.toBeNull();
    expect(markets[0]?.source).toBe("pandora.eventCoefficients");
  });
});
