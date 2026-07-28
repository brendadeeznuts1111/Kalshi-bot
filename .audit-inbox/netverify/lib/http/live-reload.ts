// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file — Bun.file
// @see https://bun.com/docs/runtime/utils#bun-sleep — Bun.sleep
// @see https://bun.com/docs/bundler/hot-reloading — bun --hot (process re-eval)
// @see https://bun.com/docs/runtime/networking/fetch#content-type-handling — Content-Type
/**
 * Browser live-reload for local static + API hosts (serve-public).
 *
 * Bun's module HMR (`bun --hot`) reloads the *server* process when TS changes.
 * This hub reloads the *browser* when files under `public/` (or other watched
 * paths) change — via SSE + a tiny injected script. Not Cloudflare Pages.
 *
 * Enable: SERVE_PUBLIC_HMR=1 (default on 127.0.0.1 for serve-public).
 * Disable: SERVE_PUBLIC_HMR=0
 */
export type LiveReloadEvent = {
  type: 'reload' | 'ping' | 'hello';
  path?: string;
  reason?: string;
  t: number;
};

type Client = {
  write: (chunk: string) => void;
  close: () => void;
};

const INJECT_MARK = '/* serve-public-live-reload */';

/** Minimal client: reconnecting EventSource → location.reload on "reload". */
export function liveReloadClientScript(endpoint = '/__hmr'): string {
  return `<script ${INJECT_MARK}>
(function () {
  if (window.__SP_HMR__) return;
  window.__SP_HMR__ = true;
  var es;
  var backoff = 500;
  function connect() {
    try { if (es) es.close(); } catch (e) {}
    es = new EventSource(${JSON.stringify(endpoint)});
    es.onopen = function () { backoff = 500; };
    es.onmessage = function (ev) {
      try {
        var msg = JSON.parse(ev.data);
        if (msg && msg.type === 'reload') {
          console.info('[hmr] reload', msg.path || msg.reason || '');
          location.reload();
        }
      } catch (e) {}
    };
    es.onerror = function () {
      try { es.close(); } catch (e) {}
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 1.5, 8000);
    };
  }
  connect();
})();
</script>`;
}

export function injectLiveReload(html: string, endpoint = '/__hmr'): string {
  if (html.includes(INJECT_MARK)) return html;
  const tag = liveReloadClientScript(endpoint);
  if (html.includes('</body>')) return html.replace('</body>', `${tag}\n</body>`);
  return html + tag;
}

export function isHtmlContentType(ct: string | null | undefined): boolean {
  return Boolean(ct && ct.toLowerCase().includes('text/html'));
}

/**
 * Optionally rewrite HTML Response bodies to inject the live-reload client.
 * Pass-through for non-HTML / empty / streaming without body.
 */
export async function maybeInjectLiveReloadResponse(
  res: Response,
  enabled: boolean
): Promise<Response> {
  if (!enabled || res.status === 204 || res.status === 304) return res;
  const ct = res.headers.get('content-type') || '';
  if (!isHtmlContentType(ct)) return res;
  try {
    const text = await res.text();
    const next = injectLiveReload(text);
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', 'no-store');
    headers.delete('content-length');
    headers.delete('etag');
    headers.delete('last-modified');
    return new Response(next, { status: res.status, statusText: res.statusText, headers });
  } catch {
    return res;
  }
}

export class LiveReloadHub {
  private clients = new Set<Client>();
  private mtimes = new Map<string, number>();
  private running = false;
  private stopFlag = false;
  private pollMs: number;
  private onChange?: (path: string) => void | Promise<void>;

  constructor(opts?: { pollMs?: number; onChange?: (path: string) => void | Promise<void> }) {
    this.pollMs = opts?.pollMs ?? 400;
    this.onChange = opts?.onChange;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** SSE stream for browsers. */
  subscribe(req: Request): Response {
    const stream = new ReadableStream<Uint8Array>({
      start: controller => {
        const enc = new TextEncoder();
        const write = (chunk: string) => {
          try {
            controller.enqueue(enc.encode(chunk));
          } catch {
            /* closed */
          }
        };
        const client: Client = {
          write,
          close: () => {
            try {
              controller.close();
            } catch {
              /* */
            }
          },
        };
        this.clients.add(client);
        write(
          `data: ${JSON.stringify({ type: 'hello', t: Date.now() } satisfies LiveReloadEvent)}\n\n`
        );

        const ping = setInterval(() => {
          write(
            `data: ${JSON.stringify({ type: 'ping', t: Date.now() } satisfies LiveReloadEvent)}\n\n`
          );
        }, 15_000);

        const abort = () => {
          clearInterval(ping);
          this.clients.delete(client);
          try {
            controller.close();
          } catch {
            /* */
          }
        };
        req.signal.addEventListener('abort', abort);
      },
      cancel: () => {
        /* client gone */
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8', // response CT (not fetch auto)
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      },
    });
  }

  notify(reason: string, path?: string): void {
    const payload = JSON.stringify({
      type: 'reload',
      reason,
      path,
      t: Date.now(),
    } satisfies LiveReloadEvent);
    const line = `data: ${payload}\n\n`;
    for (const c of [...this.clients]) {
      try {
        c.write(line);
      } catch {
        this.clients.delete(c);
      }
    }
  }

  /** Seed + poll Bun.file().lastModified (no node:fs). */
  async startPolling(paths: string[]): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopFlag = false;
    for (const p of paths) {
      try {
        const f = Bun.file(p);
        if (await f.exists()) this.mtimes.set(p, f.lastModified);
      } catch {
        /* */
      }
    }
    void this.loop(paths);
  }

  stop(): void {
    this.stopFlag = true;
    this.running = false;
    for (const c of this.clients) c.close();
    this.clients.clear();
  }

  private async loop(paths: string[]): Promise<void> {
    while (!this.stopFlag) {
      await Bun.sleep(this.pollMs);
      for (const p of paths) {
        try {
          const f = Bun.file(p);
          if (!(await f.exists())) continue;
          const m = f.lastModified;
          const prev = this.mtimes.get(p);
          if (prev === undefined) {
            this.mtimes.set(p, m);
            continue;
          }
          if (m !== prev) {
            this.mtimes.set(p, m);
            if (this.onChange) await this.onChange(p);
            this.notify('file-change', p);
          }
        } catch {
          /* */
        }
      }
    }
  }
}

/** Whether live-reload should run for this bind. */
export function shouldEnableLiveReload(opts: {
  host: string;
  env?: { SERVE_PUBLIC_HMR?: string; BUN_HOT?: string };
  argv?: string[];
}): boolean {
  const env = opts.env ?? Bun.env;
  const argv = opts.argv ?? Bun.argv;
  if (env.SERVE_PUBLIC_HMR === '0' || env.SERVE_PUBLIC_HMR === 'false') return false;
  if (env.SERVE_PUBLIC_HMR === '1' || env.SERVE_PUBLIC_HMR === 'true') return true;
  if (env.BUN_HOT === '1' || argv.includes('--hot') || argv.includes('--hmr')) return true;
  // Default on for loopback local portal
  const h = opts.host;
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}
