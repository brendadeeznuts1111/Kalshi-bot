import { describe, expect, test } from "bun:test";

// Probe-locked Blob (Web API) behavior on Bun 1.4.0 — see docs/BLOB.md.
describe("Blob (Web API) on Bun 1.4.0", () => {
  test("constructor concatenates parts and sets size/type", () => {
    const b = new Blob(["hello", " ", "world"], { type: "text/html" });
    expect(b.size).toBe(11);
    // Bun appends ;charset=utf-8 to well-known text types (probe-verified).
    expect(b.type).toBe("text/html;charset=utf-8");
  });

  test("type defaults to empty string and is lowercased", () => {
    expect(new Blob([]).type).toBe("");
    expect(new Blob(["x"], { type: "TEXT/HTML; charset=UTF-8" }).type).toBe("text/html; charset=utf-8");
  });

  test("accepts ArrayBuffer/TypedArray/DataView/Buffer/nested Blob parts", async () => {
    expect((await new Blob([new ArrayBuffer(3)]).bytes()).length).toBe(3);
    expect((await new Blob([new DataView(new ArrayBuffer(2))]).bytes()).length).toBe(2);
    expect(await new Blob([Buffer.from("buf")]).text()).toBe("buf");
    const nested = new Blob([new Blob(["ab"]), "cd"]);
    expect(await nested.text()).toBe("abcd");
    expect(nested.size).toBe(4);
  });

  test("snapshots part data at construction", async () => {
    const src = new Uint8Array([1, 2, 3]);
    const b = new Blob([src]);
    src[0] = 99;
    expect(await b.text()).toBe("\u0001\u0002\u0003");
  });

  test("bytes() and arrayBuffer() return copies", async () => {
    const b = new Blob(["abc"]);
    (await b.bytes())[0] = 90;
    expect(String.fromCharCode((await b.bytes())[0]!)).toBe("a");
    const ab = await b.arrayBuffer();
    new Uint8Array(ab)[0] = 88;
    expect(String.fromCharCode(new Uint8Array(await b.arrayBuffer())[0]!)).toBe("a");
  });

  test("stream() is a synchronous ReadableStream of the bytes", async () => {
    const parts: string[] = [];
    for await (const chunk of new Blob(["abc"]).stream()) {
      parts.push(new TextDecoder().decode(chunk));
    }
    expect(parts.join("")).toBe("abc");
  });

  test("slice() returns a new Blob", async () => {
    expect(await new Blob(["hello world"]).slice(0, 5).text()).toBe("hello");
  });

  test("type inherits from the first Blob part when options.type is omitted", () => {
    expect(new Blob([new Blob(["x"], { type: "text/plain" })]).type).toBe("text/plain;charset=utf-8");
  });

  test("Bun stringifies non-conforming parts instead of throwing", async () => {
    expect(await new Blob([{ a: 1 } as unknown as BlobPart]).text()).toBe("[object Object]");
    expect(await new Blob([123 as unknown as BlobPart]).text()).toBe("123");
    expect(await new Blob([null as unknown as BlobPart]).text()).toBe("null");
  });

  test("File adds name/lastModified and subclasses Blob", () => {
    const f = new File(["abc"], "name.html", { type: "text/html", lastModified: 12345 });
    expect(f.name).toBe("name.html");
    expect(f.lastModified).toBe(12345);
    expect(f.size).toBe(3);
    expect(f).toBeInstanceOf(Blob);
    expect(new File(["x"], "n", { lastModified: 0 }).lastModified).toBe(0);
  });

  test("BunFile subclasses Blob and reads lazily from disk", async () => {
    const path = "/tmp/kalshi-blob-test.txt";
    await Bun.write(path, "disk-content");
    const bf = Bun.file(path, { type: "text/custom" });
    expect(bf).toBeInstanceOf(Blob);
    expect(bf.size).toBe(12);
    expect(bf.type).toBe("text/custom");
    expect(await bf.text()).toBe("disk-content");
  });
});
