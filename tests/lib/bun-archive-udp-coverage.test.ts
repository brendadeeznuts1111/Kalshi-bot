/**
 * Bun.Archive + Bun.udpSocket coverage (AR-*, UDP-* ledger claims, §9) on 1.4.0.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Bun.Archive", () => {
  test("static write + instance extract round-trip (AR-write, AR-extract)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "arc-"));
    const tar = join(dir, "out.tar");
    await Bun.Archive.write(tar, { "hello.txt": "Hello, World!", "nested/f.txt": "N" });
    expect(existsSync(tar)).toBe(true);
    const a = new Bun.Archive({ "hello.txt": "Hi", "nested/f.txt": "N2" });
    const count = await a.extract(join(dir, "ex"));
    expect(count).toBe(2);
    expect(readFileSync(join(dir, "ex", "hello.txt"), "utf8")).toBe("Hi");
  });

  test("blob()/bytes() return the tarball; files() is a Map (AR-blobBytes, AR-files)", async () => {
    const a = new Bun.Archive({ "a.txt": "x".repeat(1000) });
    const blob = await a.blob();
    const bytes = await a.bytes();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.size).toBe(bytes.length);
    const files = await a.files();
    expect(files).toBeInstanceOf(Map);
    expect(files.size).toBe(1);
  });

  test("gzip compression shrinks the archive; glob filters extraction (AR-compress)", async () => {
    const big = "x".repeat(5000);
    const plain = (await new Bun.Archive({ "a.txt": big }).blob()).size;
    const gz = (await new Bun.Archive({ "a.txt": big }, { compress: "gzip" } as any).blob()).size;
    expect(gz).toBeLessThan(plain);
    const dir = mkdtempSync(join(tmpdir(), "arcg-"));
    const a = new Bun.Archive({ "hello.txt": "H", "nested/f.txt": "N" });
    const c = await a.extract(join(dir, "ex"), { glob: "nested/*" } as any);
    expect(c).toBe(1);
    expect(existsSync(join(dir, "ex", "hello.txt"))).toBe(false);
  });
});

describe("Bun.udpSocket", () => {
  test("loopback send/recv round-trips; address/close surface (UDP-create, UDP-send)", async () => {
    let resolveR: (v: string) => void = () => {};
    const recvP = new Promise<string>((res) => { resolveR = res; });
    const a: any = await Bun.udpSocket({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data: (_s: any, d: any) => resolveR(new TextDecoder().decode(d)) },
    });
    const b: any = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });
    const sent = b.send(Buffer.from("ping-42"), a.port, "127.0.0.1");
    expect(sent).toBe(true);
    expect(await recvP).toBe("ping-42");
    expect(a.address).toMatchObject({ family: "IPv4", address: "127.0.0.1" });
    expect(typeof a.port).toBe("number");
    a.close();
    expect(a.closed).toBe(true);
    b.close();
  });
});