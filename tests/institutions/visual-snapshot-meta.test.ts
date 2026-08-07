import { expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { buildVisualSnapshotMeta } from "../../src/institutions/event-store/visual-snapshot-meta.ts";

test("visual snapshot metadata is derived through Bun.Image and Bun.WebView types", async () => {
  const dir = mkdtempSync(join(tmpdir(), "visual-snapshot-meta-"));
  const sourcePath = join(dir, "source.png");
  const thumbnailPath = join(dir, "thumbnail.png");
  const onePixelPng = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  try {
    await Promise.all([
      Bun.write(sourcePath, onePixelPng),
      Bun.write(thumbnailPath, onePixelPng),
    ]);
    const meta = await buildVisualSnapshotMeta({
      capturedAt: "2026-08-06T00:00:00.000Z",
      backend: "webkit",
      width: 1280,
      height: 720,
      webviewCaptured: true,
      imageGenerated: true,
      sourcePath,
      thumbnailPath,
    });
    expect(meta.runtime).toEqual({
      bunVersion: Bun.version,
      bunRevision: Bun.revision,
    });
    expect(meta.webview).toMatchObject({
      available: true,
      captured: true,
      backend: "webkit",
      width: 1280,
      height: 720,
    });
    expect(meta.image.source?.metadata).toEqual({ width: 1, height: 1, format: "png" });
    expect(meta.image.thumbnail?.metadata).toEqual({ width: 1, height: 1, format: "png" });
    expect(meta.image.source?.sizeBytes).toBe(onePixelPng.byteLength);
    expect(meta.image.source?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(meta.webview.attempted).toBe(true);
    expect(meta.webview.error).toBeNull();
  } finally {
    await Bun.$`rm -rf ${dir}`.nothrow().quiet();
  }
});
