import { describe, expect, test } from "bun:test";

const appPath = new URL("../../src/research/hq-app/app.js", import.meta.url);
const cssPath = new URL("../../src/research/hq-app/styles.css", import.meta.url);
const serverPath = new URL("../../src/research/serve.ts", import.meta.url);

describe("Tennis HQ data health surface", () => {
  test("renders reconciliation counts and venue volumes without a ratio", async () => {
    const app = await Bun.file(appPath).text();
    expect(app).toContain("Cross-market data health");
    expect(app).toContain("events matched");
    expect(app).toContain("Kalshi 24h");
    expect(app).toContain("Polymarket 24h");
    expect(app).toContain("their units differ");
    expect(app).toContain("Inspect coverage payload");
    expect(app).toContain("without a cross-venue link");
  });

  test("uses a two-column health-first desk grid with a mobile fallback", async () => {
    const css = await Bun.file(cssPath).text();
    expect(css).toContain(".tennis-desk-shell");
    expect(css).toContain('"health health"');
    expect(css).toContain('"board desk"');
    expect(css).toContain("1.15fr");
    expect(css).toContain(".health-grid");
  });

  test("serves the persisted Tennis HQ health payload", async () => {
    const server = await Bun.file(serverPath).text();
    expect(server).toContain('url.pathname === "/api/hq/tennis"');
    expect(server).toContain("buildTennisHqPayload()");
  });
});
