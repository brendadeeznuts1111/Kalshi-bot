import { describe, expect, test } from "bun:test";
import { YAML } from "bun";

// Probe-locked Bun.markdown / Bun.YAML / BunFile Range+304 behavior on 1.4.0 —
// see docs/BUN_MEDIA_METADATA.md §10.

describe("Bun.markdown / Bun.YAML / file serving (Bun 1.4.0)", () => {
  test("Bun.markdown.html renders headings and emphasis", () => {
    const html = (Bun.markdown as any).html("# Hello **world**");
    expect(html).toContain("<h1>");
    expect(html).toContain("<strong>world</strong>");
  });

  test("Bun.markdown.render returns plain text", () => {
    const out = (Bun.markdown as any).render("# Hi", {});
    expect(String(out).trim()).toBe("Hi");
  });

  test("Bun.markdown exposes html/ansi/render/react", () => {
    const m = (Bun.markdown as any);
    for (const k of ["html", "ansi", "render", "react"]) {
      expect(typeof m[k]).toBe("function");
    }
  });

  test("YAML.parse / stringify round-trip", () => {
    const parsed = YAML.parse("a: 1\nb: [1, 2]");
    expect(parsed).toEqual({ a: 1, b: [1, 2] });
    const out = YAML.stringify({ a: 1, b: [1, 2] });
    expect(YAML.parse(out)).toEqual({ a: 1, b: [1, 2] });
    expect((Bun as any).YAML.parse("x: hello")).toEqual({ x: "hello" });
  });

  test("BunFile Range requests get 206 + Content-Range automatically", async () => {
    const p = "/tmp/kalshi-range-test.mp4";
    await Bun.write(p, new Uint8Array(204800).fill(7));
    const server = Bun.serve({ port: 0, fetch: () => new Response(Bun.file(p)) });
    try {
      const r = await fetch("http://127.0.0.1:" + server.port + "/", { headers: { Range: "bytes=0-99" } });
      expect(r.status).toBe(206);
      expect(r.headers.get("content-range")).toBe("bytes 0-99/204800");
      expect((await r.arrayBuffer()).byteLength).toBe(100);
      const full = await fetch("http://127.0.0.1:" + server.port + "/");
      expect(full.status).toBe(200);
      expect(full.headers.get("etag")).toBeNull(); // no auto-ETag
    } finally {
      server.stop();
    }
  });

  test("304 requires a manual ETag + If-None-Match check", async () => {
    const p = "/tmp/kalshi-range-test.mp4";
    const etag = '"abc123"';
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304 });
        return new Response(Bun.file(p), { headers: { ETag: etag } });
      },
    });
    try {
      const hit = await fetch("http://127.0.0.1:" + server.port + "/", { headers: { "If-None-Match": etag } });
      expect(hit.status).toBe(304);
      const miss = await fetch("http://127.0.0.1:" + server.port + "/");
      expect(miss.status).toBe(200);
      expect(miss.headers.get("etag")).toBe(etag);
    } finally {
      server.stop();
    }
  });
});
