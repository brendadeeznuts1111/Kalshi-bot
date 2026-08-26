// Locks the Blob behaviors verified by runtime probes on Bun 1.4.0.
// Corrections baked in (vs common guides):
//   - img.webp({q}) is CHAINABLE (returns Image) — .bytes() is the terminal
//   - postMessage(blob, [blob]) TRANSFER throws DataCloneError (clone w/o
//     transfer works; to move ownership, transfer the ArrayBuffer)
//   - Bun.WebView CANNOT navigate to blob: URLs (WebKitBlobResource) — use
//     data: URLs (repo gotcha, §178)
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, rmSync } from 'node:fs';

const WORKER_SRC = '/tmp/blob-verified-worker.ts';
const PNG = '/tmp/probe32.png';

beforeAll(() => {
  writeFileSync(
    WORKER_SRC,
    'self.onmessage = (e) => { const b = e.data.screenshot; const isBlob = b instanceof Blob;' +
      ' b.arrayBuffer().then((buf) => self.postMessage({ isBlob, bytes: buf.byteLength })); };',
  );
});
afterAll(() => rmSync(WORKER_SRC, { force: true }));

describe('Blob verified patterns (Bun 1.4.0)', () => {
  test('URL.createObjectURL returns a blob: URL and revokeObjectURL cleans up', () => {
    const b = new Blob(['x'], { type: 'text/plain' });
    const url = URL.createObjectURL(b) as string;
    expect(url.startsWith('blob:')).toBe(true);
    URL.revokeObjectURL(url);
  });

  test('blob.slice is cheap (no copy) and blob.stream() is a ReadableStream', () => {
    const b = new Blob([new Uint8Array(1024).fill(1)]);
    expect(b.slice(0, 10).size).toBe(10);
    expect(b.stream()).toBeInstanceOf(ReadableStream);
  });

  test('new Response(blob) streams the bytes', async () => {
    const b = new Blob([new Uint8Array(512).fill(2)]);
    const got = await new Response(b).arrayBuffer();
    expect(got.byteLength).toBe(512);
  });

  test('Bun.write accepts a Blob directly', async () => {
    const b = new Blob([new Uint8Array(256).fill(3)]);
    await Bun.write('/tmp/blob-verified-out.bin', b);
    expect(await Bun.file('/tmp/blob-verified-out.bin').size).toBe(256);
  });

  test('new Bun.Image(blob) works (constructor accepts Blob)', async () => {
    const blob = new Blob([await Bun.file(PNG).arrayBuffer()], { type: 'image/png' });
    const img = new Bun.Image(blob);
    const meta = await img.metadata();
    expect(meta.width).toBeGreaterThan(0);
  });

  test('img.webp({quality}) is CHAINABLE — returns Image, not encoded bytes', async () => {
    const img = new Bun.Image(await Bun.file(PNG).arrayBuffer());
    const r: any = await img.webp({ quality: 85 });
    expect(r).toBeInstanceOf(Bun.Image);
    const bytes = await img.webp({ quality: 85 }).bytes();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  test('structured clone of a Blob across a worker works WITHOUT transfer', async () => {
    const worker = new Worker(WORKER_SRC);
    const done = new Promise<void>((resolve) => {
      worker.onmessage = (e: any) => {
        expect(e.data.isBlob).toBe(true);
        expect(e.data.bytes).toBe(64);
        resolve();
      };
    });
    const payload = new Blob([new Uint8Array(64).fill(4)]);
    worker.postMessage({ screenshot: payload }); // no transfer list
    await done;
    expect(payload.size).toBe(64); // sender still usable
    worker.terminate();
  });

  test('transferring a Blob via the postMessage transfer list throws DataCloneError', () => {
    const worker = new Worker(WORKER_SRC);
    const payload = new Blob([new Uint8Array(16)]);
    expect(() => worker.postMessage({ screenshot: payload }, [payload])).toThrow(/DataCloneError|can not be cloned|cannot be cloned/i);
    worker.terminate();
  });

  test.skip('Bun.WebView screenshot() defaults to a Blob (image/png)', async () => {
    await using view = new Bun.WebView({
      width: 120,
      height: 90,
      backend: process.platform === 'darwin' ? 'webkit' : 'chrome',
      url: 'data:text/html,<h1>x</h1>',
    } as any);
    await new Promise((r) => setTimeout(r, 500));
    const shot: any = await (view as any).screenshot();
    expect(shot).toBeInstanceOf(Blob);
    expect((shot as Blob).type).toBe('image/png');
  });

  test.skip('Bun.WebView CANNOT navigate to a blob: URL (WebKitBlobResource) — use data:', async () => {
    const url = URL.createObjectURL(new Blob(['<h1>hi</h1>'], { type: 'text/html' }));
    await using view = new Bun.WebView({
      width: 120,
      height: 90,
      backend: process.platform === 'darwin' ? 'webkit' : 'chrome',
      url: 'about:blank',
    } as any);
    await new Promise((r) => setTimeout(r, 400));
    let threw = false;
    try {
      await (view as any).navigate(url);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true); // documented limitation — data: URLs keep it offline
    URL.revokeObjectURL(url);
  });
});
