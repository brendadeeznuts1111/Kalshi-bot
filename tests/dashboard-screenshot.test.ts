// @see https://bun.com/docs/test/index#run-tests
import { afterEach, describe, expect, test } from "bun:test";
import { joinPath, EVIDENCE_DIR } from "../src/research/paths.ts";
import {
  buildDashboardThumbnail,
  dashboardEvidenceSlug,
  loadLatestDashboardScreenshot,
  processDashboardScreenshotBytes,
  readPngImageMeta,
  renderAuditEvidenceSection,
  sha256HexBytes,
} from "../src/agent/dashboard-screenshot.ts";
import { handleDashboardScreenshotPost, handleEvidenceFile } from "../src/agent/dashboard-server.ts";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

describe("dashboard-screenshot", () => {
  const dir = joinPath(import.meta.dir, ".tmp-evidence");

  afterEach(async () => {
    try {
      await Bun.$`rm -rf ${dir}`.quiet();
    } catch {
      // ignore
    }
  });

  test("readPngImageMeta reads header without full decode", async () => {
    const meta = await readPngImageMeta(TINY_PNG);
    expect(meta).toEqual({ width: 1, height: 1, format: "png" });
  });

  test("processDashboardScreenshotBytes writes full, thumb, manifest", async () => {
    const slug = dashboardEvidenceSlug(new Date("2026-07-22T07:37:43.000Z"));
    const manifest = await processDashboardScreenshotBytes(TINY_PNG, { outDir: dir, slug });

    expect(manifest.ok).toBe(true);
    expect(manifest.full).toBe(`/evidence/${slug}.png`);
    expect(manifest.thumbnail).toBe(`/evidence/${slug}-thumb.png`);
    expect(manifest.bytes).toBe(TINY_PNG.byteLength);
    expect(manifest.sha256).toBe(sha256HexBytes(TINY_PNG));
    expect(manifest.image).toEqual({ width: 1, height: 1, format: "png" });

    expect(await Bun.file(manifest.fullPath).exists()).toBe(true);
    expect(await Bun.file(manifest.thumbnailPath).exists()).toBe(true);

    const latest = await loadLatestDashboardScreenshot(dir);
    expect(latest?.sha256).toBe(manifest.sha256);
  });

  test("buildDashboardThumbnail produces smaller PNG", async () => {
    const thumb = await buildDashboardThumbnail(TINY_PNG);
    expect(thumb.byteLength).toBeGreaterThan(0);
    expect(thumb.byteLength).toBeLessThanOrEqual(TINY_PNG.byteLength);
  });

  test("renderAuditEvidenceSection shows three verification dimensions", async () => {
    const manifest = await processDashboardScreenshotBytes(TINY_PNG, { outDir: dir });
    const html = renderAuditEvidenceSection(manifest);
    expect(html).toContain("Audit evidence");
    expect(html).toContain(manifest.sha256);
    expect(html).toContain("1×1 png");
    expect(html).toContain(manifest.thumbnail);
  });

  test("handleDashboardScreenshotPost returns wire shape", async () => {
    const res = await handleDashboardScreenshotPost(new Request("http://127.0.0.1/api/screenshot", { method: "POST" }), {
      captureScreenshot: {
        probeAndCapture: async () => TINY_PNG,
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      full: string;
      thumbnail: string;
      bytes: number;
      sha256: string;
      image: { width: number; height: number; format: string };
    };
    expect(body.ok).toBe(true);
    expect(body.full).toMatch(/^\/evidence\/dashboard-/);
    expect(body.thumbnail).toMatch(/-thumb\.png$/);
    expect(body.image.format).toBe("png");
    expect(body.sha256).toHaveLength(64);
  });

  test("handleEvidenceFile serves PNG from evidence dir", async () => {
    const slug = `test-evidence-${Date.now()}`;
    const manifest = await processDashboardScreenshotBytes(TINY_PNG, { outDir: EVIDENCE_DIR, slug });
    const name = manifest.full.replace("/evidence/", "");
    const res = await handleEvidenceFile(new Request(`http://127.0.0.1/evidence/${name}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBe(TINY_PNG.byteLength);
    await Bun.$`rm -f ${manifest.fullPath} ${manifest.thumbnailPath}`.quiet();
  });
});
