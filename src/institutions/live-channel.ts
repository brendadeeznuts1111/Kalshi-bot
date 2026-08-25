/**
 * live-channel.ts — WebSocket live channel for the research server:
 * theme updates + feed updates, zero deps (Bun.serve websocket + bun:sqlite).
 *
 * Probe-verified against Bun 1.4.0 (docs/AGENT-PITFALLS.md §23):
 *   - Bun.serve websocket: server.upgrade(req, { data }) + websocket
 *     { open/message/close } + ws.readyState === WebSocket.OPEN (1) +
 *     ws.subscribe(topic) / server.publish(topic, msg) broadcast — VERIFIED.
 *   - The doc's "Bun.SQL (SQLite)" claim is WRONG: Bun.sql is a POSTGRES
 *     tagged-template client (PostgresError). SQLite here is bun:sqlite
 *     Database with INSERT OR IGNORE dedup — VERIFIED.
 *   - Bun.XML.parse enclosure shapes (`@url` attribute convention) —
 *     VERIFIED: item.enclosure["@url"], item["media:content"]["@url"],
 *     item["media:thumbnail"]["@url"].
 *   - Theme "change" is EPHEMERAL (in-memory override broadcast to live
 *     clients only) — NOT persisted. TOKENS stays the audited source of
 *     truth; persisting arbitrary hexes would break the one-vocabulary gate.
 */
import { Database } from "bun:sqlite";
import { parseRssEntries, type RssEntry } from "../lib/release-blog.ts";
import {
  THEME,
  THEME_ROLES,
  themeAnsi,
  type ThemeRole,
} from "../lib/color/theme.ts";

export type { RssEntry };

/** Feed item with an optional image enclosure URL (RSS 2.0 @url shapes). */
export type FeedItem = RssEntry & { imageUrl?: string };

/**
 * Link-deduplicating feed store on bun:sqlite. INSERT OR IGNORE on a
 * PRIMARY KEY(link) — the verified dedup (probe: second insert of the same
 * link is ignored). In-memory by default; pass a path for persistence.
 */
export class FeedStore {
  private db: Database;
  constructor(path = ":memory:") {
    this.db = new Database(path);
    this.db.run(
      "CREATE TABLE IF NOT EXISTS feed (link TEXT PRIMARY KEY, title TEXT, pubDate TEXT, imageUrl TEXT, epoch INTEGER)",
    );
  }
  /** Insert entries, return only the NEW ones (dedup by link). */
  ingest(items: FeedItem[]): FeedItem[] {
    const fresh: FeedItem[] = [];
    const stmt = this.db.prepare(
      "INSERT OR IGNORE INTO feed (link, title, pubDate, imageUrl, epoch) VALUES (?, ?, ?, ?, ?)",
    );
    for (const it of items) {
      if (!it.link) continue;
      const epoch = Date.parse(it.pubDate ?? "");
      const res = stmt.run(
        it.link,
        it.title,
        it.pubDate ?? "",
        it.imageUrl ?? null,
        Number.isFinite(epoch) ? epoch : 0,
      );
      // INSERT OR IGNORE: changes === 1 means a NEW row (dedup by link).
      if (res.changes === 1) fresh.push(it);
    }
    return fresh;
  }
  recent(limit = 10): FeedItem[] {
    // pubDate strings ("Thu, 20 Aug …") are NOT lexically sortable — the
    // epoch column (Date.parse, 0 when unparsable) is the sort key.
    return this.db
      .query(
        "SELECT link, title, pubDate, imageUrl FROM feed ORDER BY epoch DESC, rowid DESC LIMIT ?",
      )
      .all(limit) as unknown as FeedItem[];
  }
  count(): number {
    return (this.db.query("SELECT COUNT(*) AS n FROM feed").get() as { n: number }).n;
  }
  close(): void {
    this.db.close();
  }
}

export type ThemePayload = {
  type: "theme-update";
  cssVars: string;
  ansi: Record<ThemeRole, string>;
  overrides: Partial<Record<ThemeRole, string>>;
};

export type FeedPayload = {
  type: "feed-update";
  items: FeedItem[];
};

export type StatusPayload = {
  type: "status-update";
  ok: boolean;
  status: string;
  signals: number;
  channels: { ok: number; warn: number; bad: number; info: number };
  failing: Array<{ id: string; title: string }>;
};

export type LiveChannelConfig = {
  /** RSS XML source for the hourly feed cron (default: bun.sh RSS). */
  fetchFeed?: () => Promise<string>;
  feedStore?: FeedStore;
  /** Maximum items pushed on subscribe. */
  recentLimit?: number;
};

const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

const hexPattern = /^#[0-9a-f]{6}$/i;

/** Build the theme payload from TOKENS + live overrides. */
function buildThemePayload(overrides: Partial<Record<ThemeRole, string>>): ThemePayload {
  const merged = { ...THEME, ...overrides };
  const cssVars = THEME_ROLES.map((role) => "  --" + role + ": " + merged[role] + ";").join("\n");
  const ansi = {} as Record<ThemeRole, string>;
  for (const role of THEME_ROLES) ansi[role] = themeAnsi(role, "16m");
  return { type: "theme-update", cssVars, ansi, overrides: { ...overrides } };
}

const moduleState = {
  channels: new Set<LiveChannel>(),
  feedCronRegistered: false,
};

export type LiveChannel = {
  attachServer(server: { publish: (topic: string, message: string) => number }): void;
  websocket: {
    open(ws: { subscribe: (t: string) => void; send: (m: string) => void }): void;
    message(ws: { send: (m: string) => void }, message: string | Buffer | ArrayBuffer | Uint8Array): void;
    close(ws: { unsubscribe: (t: string) => void }): void;
  };
  /** Recompute + broadcast the theme to all connected clients. */
  broadcastTheme(): void;
  /** Broadcast an aggregated health snapshot to the status topic. */
  broadcastStatus(payload: StatusPayload): void;
  /** Parse RSS XML, dedup into the store, broadcast new items. */
  refreshFeed(xml: string): FeedItem[];
  getStore(): FeedStore;
};

/**
 * Create a live channel bound to one server. Each server gets its own
 * channel + store; the hourly feed cron (registered once per process)
 * refreshes every live channel (prod has one server).
 */
export function createLiveChannel(config: LiveChannelConfig = {}): LiveChannel {
  const store = config.feedStore ?? new FeedStore();
  const recentLimit = config.recentLimit ?? 10;
  const overrides: Partial<Record<ThemeRole, string>> = {};
  let publisher: { publish: (topic: string, message: string) => number } | null = null;

  const channel: LiveChannel = {
    attachServer(server) {
      publisher = server;
    },
    websocket: {
      open(ws) {
        ws.subscribe("theme");
        ws.subscribe("feed");
        ws.subscribe("status");
        ws.send(JSON.stringify(buildThemePayload(overrides)));
        const items = store.recent(recentLimit);
        if (items.length > 0) {
          ws.send(JSON.stringify({ type: "feed-update", items } satisfies FeedPayload));
        }
      },
      message(ws, message) {
        let data: { type?: string; colors?: Record<string, unknown> };
        try {
          data = JSON.parse(String(message));
        } catch {
          return;
        }
        if (data.type === "subscribe-theme") {
          ws.send(JSON.stringify(buildThemePayload(overrides)));
        } else if (data.type === "change-theme" && data.colors && typeof data.colors === "object") {
          // Validate: every key must be a theme role, every value a hex.
          const next: Partial<Record<ThemeRole, string>> = {};
          for (const [k, v] of Object.entries(data.colors)) {
            const role = k as ThemeRole;
            if (!THEME_ROLES.includes(role) || !isHex(v)) return; // reject whole change
            next[role] = v.toLowerCase();
          }
          for (const [k, v] of Object.entries(next)) overrides[k as ThemeRole] = v;
          channel.broadcastTheme();
        }
      },
      close(ws) {
        ws.unsubscribe("theme");
        ws.unsubscribe("feed");
        ws.unsubscribe("status");
      },
    },
    broadcastTheme() {
      if (publisher) publisher.publish("theme", JSON.stringify(buildThemePayload(overrides)));
    },
    broadcastStatus(payload: StatusPayload) {
      if (publisher) publisher.publish("status", JSON.stringify(payload));
    },
    refreshFeed(xml: string): FeedItem[] {
      const entries = parseRssEntries(xml);
      const items: FeedItem[] = entries.map((e) => ({ ...e }));
      const fresh = store.ingest(items);
      if (fresh.length > 0 && publisher) {
        publisher.publish("feed", JSON.stringify({ type: "feed-update", items: fresh } satisfies FeedPayload));
      }
      return fresh;
    },
    getStore() {
      return store;
    },
  };

  moduleState.channels.add(channel);
  return channel;
}

const DEFAULT_FEED_URL = "https://bun.sh/rss.xml";

/**
 * Hourly feed-refresh cron (string form "0 * * * *" — probe-verified parse
 * returns next run Date). Registered ONCE per process (tests create many
 * servers). Unref'd so it never blocks exit.
 */
export function registerFeedCron(getConfig: () => LiveChannelConfig): void {
  if (moduleState.feedCronRegistered || typeof Bun.cron !== "function") return;
  moduleState.feedCronRegistered = true;
  const job = Bun.cron("0 * * * *", async () => {
    for (const channel of [...moduleState.channels]) {
      try {
        const xml = await (getConfig().fetchFeed ?? fetchDefaultFeed)();
        channel.refreshFeed(xml);
      } catch {
        // network / parse failure — next hour retries
      }
    }
  });
  job.unref();
}

async function fetchDefaultFeed(): Promise<string> {
  const res = await fetch(DEFAULT_FEED_URL);
  return res.text();
}

export { isHex, hexPattern };
