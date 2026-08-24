// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { isSafeVideoId, isVideoFile, renderVideoPage } from "../../src/research/video-page.ts";
import { designAgent } from "../../src/agent/design-agent.ts";
import { BRAND } from "../../src/institutions/design-tokens.ts";

describe("video page (branded <video> consumer)", () => {
  test("isVideoFile accepts video extensions, rejects others", () => {
    expect(isVideoFile("brand-card.mp4")).toBe(true);
    expect(isVideoFile("demo.webm")).toBe(true);
    expect(isVideoFile("clip.MOV")).toBe(true);
    expect(isVideoFile("notes.md")).toBe(false);
    expect(isVideoFile("image.png")).toBe(false);
  });

  test("page is token-compliant and references the served route path", () => {
    const html = renderVideoPage(["brand-card.mp4", "demo.webm"]);
    const audit = designAgent.audit(html);
    expect(audit.issues).toEqual([]);
    // Route path, never a relative asset (data: URL inlining pitfall).
    expect(html).toContain('src="/videos/brand-card.mp4"');
    expect(html).toContain('src="/videos/demo.webm"');
    expect(html).toContain(BRAND.name);
    expect(html).toContain("design-system.css");
  });

  test("empty state guides the operator", () => {
    const html = renderVideoPage([]);
    expect(html).toContain("No videos yet");
    expect(html).toContain("public/videos");
  });
});

describe("isSafeVideoId (param-route traversal guard)", () => {
  test("accepts valid single-segment video names", () => {
    expect(isSafeVideoId("brand-card.mp4")).toBe(true);
    expect(isSafeVideoId("demo.webm")).toBe(true);
    expect(isSafeVideoId("clip.MOV")).toBe(true);
  });

  test("rejects traversal, separators, non-video, hidden, NUL, oversized", () => {
    expect(isSafeVideoId("..%2F..%2Fpackage.json")).toBe(false);
    expect(isSafeVideoId("../x.mp4")).toBe(false);
    expect(isSafeVideoId("sub/x.mp4")).toBe(false);
    expect(isSafeVideoId("a\\b.mp4")).toBe(false);
    expect(isSafeVideoId("notes.txt")).toBe(false);
    expect(isSafeVideoId(".hidden.mp4")).toBe(false);
    expect(isSafeVideoId("a\u0000b.mp4")).toBe(false);
    expect(isSafeVideoId("x".repeat(200) + ".mp4")).toBe(false);
    expect(isSafeVideoId("")).toBe(false);
    expect(isSafeVideoId(undefined)).toBe(false);
  });
});
