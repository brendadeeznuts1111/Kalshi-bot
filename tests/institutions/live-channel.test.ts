// Live channel tests — WebSocket theme/feed broadcast, bun:sqlite dedup,
// and RSS imageUrl extraction. The WS roundtrip spins a REAL Bun.serve with
// the websocket config (probe-verified: upgrade + open/message + publish).
import { describe, expect, test } from "bun:test";
import {
  createLiveChannel,
  FeedStore,
  isHex,
  type LiveChannel,
} from "../../src/institutions/live-channel.ts";
import { parseRssEntries } from "../../src/lib/release-blog.ts";

const RSS_XML = [
  '<?xml version="1.0"?>',
  "<rss><channel><title>t</title>",
  '<item><title>A</title><link>https://bun.com/a</link><pubDate>Thu, 20 Aug 2026 00:00:00 GMT</pubDate></item>',
  '<item><title>B</title><link>https://bun.com/b</link><pubDate>Wed, 19 Aug 2026 00:00:00 GMT</pubDate></item>',
  "</channel></rss>",
].join("\n");

describe("FeedStore (bun:sqlite dedup)", () => {
  test("ingest dedups by link, returns only new items", () => {
    const store = new FeedStore();
    const first = store.ingest(parseRssEntries(RSS_XML));
    expect(first).toHaveLength(2);
    const dup = store.ingest(parseRssEntries(RSS_XML));
    expect(dup).toHaveLength(0);
    expect(store.count()).toBe(2);
  });

  test("recent returns newest first", () => {
    const store = new FeedStore();
    store.ingest(parseRssEntries(RSS_XML));
    const recent = store.recent();
    expect(recent[0]!.link).toBe("https://bun.com/a");
  });
});

describe("isHex validation", () => {
  test("accepts lowercase/uppercase 6-digit hex, rejects others", () => {
    expect(isHex("#4da3ff")).toBe(true);
    expect(isHex("#4DA3FF")).toBe(true);
    expect(isHex("4da3ff")).toBe(false);
    expect(isHex("#4da3f")).toBe(false);
    expect(isHex("#gggggg")).toBe(false);
    expect(isHex(42)).toBe(false);
  });
});

describe("live channel WebSocket roundtrip", () => {
  test("upgrade -> theme-update on open, change-theme broadcast, feed-update", async () => {
    const channel = createLiveChannel();
    const store = channel.getStore();
    store.ingest([{ title: "A", link: "https://bun.com/a", pubDate: "now" }]);

    const server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        if (new URL(req.url).pathname === "/api/live") {
          const ok = srv.upgrade(req);
          return ok ? undefined : new Response("upgrade failed", { status: 400 });
        }
        return new Response("hi");
      },
      websocket: {
        open: (ws) => channel.websocket.open(ws),
        message: (ws, msg) => channel.websocket.message(ws, msg),
        close: (ws) => channel.websocket.close(ws),
      },
    });
    channel.attachServer(server);

    const messages: string[] = [];
    let changedSeen = false;
    const ws = new WebSocket("ws://127.0.0.1:" + server.port + "/api/live");
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout: " + JSON.stringify(messages))), 4000);
      ws.onmessage = (e) => {
        const msg = JSON.parse(String(e.data));
        messages.push(String(e.data));
        if (msg.type === "theme-update" && !msg.overrides?.primary) {
          ws.send(JSON.stringify({ type: "change-theme", colors: { primary: "#112233" } }));
        }
        if (msg.type === "theme-update" && msg.overrides?.primary === "#112233") {
          changedSeen = true;
          channel.refreshFeed(RSS_XML);
        }
        // Resolve once the changed theme AND a feed broadcast arrived
        // (the open handler also pushes recent items, so wait for both).
        if (changedSeen && messages.map((m) => JSON.parse(m)).some((m) => m.type === "feed-update")) {
          clearTimeout(timer);
          resolve();
        }
      };
      ws.onerror = (e) => { clearTimeout(timer); reject(new Error("ws error")); };
    });
    await done;
    ws.close();
    server.stop(true);

    const parsed = messages.map((m) => JSON.parse(m));
    const firstTheme = parsed.find((m) => m.type === "theme-update" && !m.overrides?.primary);
    expect(firstTheme.cssVars).toContain("--primary: #4da3ff;");
    expect(firstTheme.ansi.primary).toContain("\x1b[38;2;");
    const changed = parsed.find((m) => m.type === "theme-update" && m.overrides?.primary === "#112233");
    expect(changed.cssVars).toContain("--primary: #112233;");
    const feed = parsed.find((m) => m.type === "feed-update");
    expect(feed.items.length).toBeGreaterThan(0);
  }, 10000);

  test("invalid change-theme is rejected (no broadcast)", async () => {
    const channel = createLiveChannel();
    const server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        if (new URL(req.url).pathname === "/api/live") {
          const ok = srv.upgrade(req);
          return ok ? undefined : new Response("upgrade failed", { status: 400 });
        }
        return new Response("hi");
      },
      websocket: {
        open: (ws) => channel.websocket.open(ws),
        message: (ws, msg) => channel.websocket.message(ws, msg),
        close: (ws) => channel.websocket.close(ws),
      },
    });
    channel.attachServer(server);
    const messages: string[] = [];
    const ws = new WebSocket("ws://127.0.0.1:" + server.port + "/api/live");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1500);
      ws.onmessage = (e) => {
        messages.push(String(e.data));
        const parsed = JSON.parse(String(e.data));
        if (parsed.type === "theme-update" && !parsed.overrides?.primary) {
          ws.send(JSON.stringify({ type: "change-theme", colors: { primary: "not-a-hex" } }));
          setTimeout(() => { clearTimeout(timer); resolve(); }, 500);
        }
      };
    });
    ws.close();
    server.stop(true);
    const updates = messages.map((m) => JSON.parse(m)).filter((m) => m.type === "theme-update");
    expect(updates.every((m) => !m.overrides?.primary)).toBe(true);
  }, 10000);
});
