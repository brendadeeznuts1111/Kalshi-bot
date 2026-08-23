/**
 * memoryPressure integration on createResearchServer (v1.4 low-memory
 * notification). The handler clears the in-process book cache and sports
 * source catalog on 'critical' (pitfalls section 20: the paste claimed
 * 'already integrated' — now actually true).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createResearchServer } from '../../src/research/serve.ts';

describe('createResearchServer memoryPressure handler', () => {
  let server: ReturnType<typeof createResearchServer>;
  let warns: string[] = [];
  const origWarn = console.warn;

  beforeAll(() => {
    console.warn = (msg?: unknown) => { warns.push(String(msg)); };
    server = createResearchServer({ port: 0 });
  });

  afterAll(() => {
    server.stop(true);
    console.warn = origWarn;
  });

  test('server responds normally after a critical memory-pressure event', async () => {
    // Prime the server (any request), then simulate OS low-memory.
    const before = await fetch(server.url + 'api/hq');
    expect(before.status).toBe(200);
    warns = [];
    process.emit('memoryPressure', 'critical');
    // Handler logs the clear; server must still serve.
    expect(warns.some((w) => w.includes('memoryPressure critical'))).toBe(true);
    const after = await fetch(server.url + 'api/hq');
    expect(after.status).toBe(200);
  });

  test('non-critical pressure does not clear caches (no warn)', () => {
    warns = [];
    process.emit('memoryPressure', 'warning');
    expect(warns.some((w) => w.includes('memoryPressure critical'))).toBe(false);
  });
});