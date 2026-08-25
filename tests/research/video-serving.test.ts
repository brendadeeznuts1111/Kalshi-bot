// video-serving contract (§118): a served .mp4 gets video/mp4, byte-
// range 206 responses with correct Content-Range, and seek ranges —
// the prerequisites for a <video> element with seeking. Self-contained
// (own Bun.serve dir route, scratch fixture) — no baked artifacts.
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { serve } from "bun";

const dir = mkdtempSync(join("/tmp", "video-serving-"));
const FILE = join(dir, "clip.mp4");

describe("video serving (mp4 dir route, §118)", () => {
  let server: ReturnType<typeof serve>;

  beforeAll(() => {
    // Minimal mp4-ish fixture: ftyp box + payload — the contract is
    // content-type + range semantics, not decode.
    writeFileSync(FILE, Buffer.concat([Buffer.from([0, 0, 0, 20, 102, 116, 121, 112]), Buffer.alloc(1024, 7)]));
    server = serve({ port: 0, routes: { "/videos/*": { dir } } });
  });

  afterAll(() => {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("serves .mp4 with video/mp4 content-type", async () => {
    const res = await fetch(server.url + "/videos/clip.mp4", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("video/mp4");
  });

  test("Range request returns 206 with the exact partial bytes", async () => {
    const res = await fetch(server.url + "/videos/clip.mp4", { headers: { Range: "bytes=0-99" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-99/1032");
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  test("a seek range past the start works (mid-file 206)", async () => {
    const res = await fetch(server.url + "/videos/clip.mp4", { headers: { Range: "bytes=500-599" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 500-599/1032");
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });
});
