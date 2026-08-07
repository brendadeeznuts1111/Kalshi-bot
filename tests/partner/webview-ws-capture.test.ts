import { expect, test } from "bun:test";
import { redactCaptureUrl } from "../../src/partner/webview-ws-capture.ts";
import {
  parseCdpWebSocketCreated,
  parseCdpWebSocketFrame,
} from "../../src/partner/webview-cdp-events.ts";

test("WebView capture summaries redact signed URL material", () => {
  expect(
    redactCaptureUrl(
      "https://plive.example/live/path?token=secret&account=42#!/sport/220",
    ),
  ).toBe("https://plive.example/live/path");
  expect(redactCaptureUrl("not a URL")).toBe("[redacted-invalid-url]");
});

test("local CDP adapter validates data/detail without augmenting Bun types", () => {
  expect(
    parseCdpWebSocketCreated({
      data: { requestId: "r1", url: "wss://example.test/socket", ignored: 1 },
    }),
  ).toEqual({ requestId: "r1", url: "wss://example.test/socket" });
  expect(
    parseCdpWebSocketFrame({
      detail: { requestId: "r1", response: { payloadData: "42[]" } },
    }),
  ).toEqual({ requestId: "r1", response: { payloadData: "42[]" } });
  expect(parseCdpWebSocketFrame({ data: "invalid" })).toEqual({});
});
