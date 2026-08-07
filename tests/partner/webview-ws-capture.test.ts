import { expect, test } from "bun:test";
import { redactCaptureUrl } from "../../src/partner/webview-ws-capture.ts";

test("WebView capture summaries redact signed URL material", () => {
  expect(
    redactCaptureUrl(
      "https://plive.example/live/path?token=secret&account=42#!/sport/220",
    ),
  ).toBe("https://plive.example/live/path");
  expect(redactCaptureUrl("not a URL")).toBe("[redacted-invalid-url]");
});
