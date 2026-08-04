// @see https://bun.com/docs/api/websockets
/**
 * Minimal Engine.IO v4 + Socket.IO client for Fantasy Ultra live odds.
 *
 * Confirmed URL:
 *   wss://pandora.ganchrow.com/socket.io/?EIO=4&transport=websocket
 *
 * Handshake (live-probed):
 *   ← 0{"sid","pingInterval","pingTimeout",...}
 *   → 40   (connect default namespace)
 *   ← 40{"sid":"..."}
 *   ← 2 / → 3  (Engine.IO ping/pong)
 *
 * Subscription emit + odds payload format: **not yet captured** — pass raw
 * frames via onPacket / onEvent once DevTools Messages are available.
 */
import { FANTASY_WIDGET_CONFIG } from "./widget-config.ts";

/** Engine.IO packet types (EIO=4). */
export const EIO = {
  open: "0",
  close: "1",
  ping: "2",
  pong: "3",
  message: "4",
  upgrade: "5",
  noop: "6",
} as const;

/** Socket.IO packet types (inside Engine.IO message). */
export const SIO = {
  connect: "0",
  disconnect: "1",
  event: "2",
  ack: "3",
  connectError: "4",
  binaryEvent: "5",
  binaryAck: "6",
} as const;

export type PandoraOpenInfo = {
  sid: string;
  pingInterval: number;
  pingTimeout: number;
  maxPayload?: number;
};

export type PandoraSocketHandlers = {
  onOpen?: (info: PandoraOpenInfo) => void;
  onNamespaceConnect?: (sid: string) => void;
  /** Every raw WebSocket text frame */
  onPacket?: (raw: string) => void;
  /**
   * Socket.IO EVENT (42...) payloads: event name + args array.
   * Unknown until widget Messages are captured.
   */
  onEvent?: (eventName: string, args: unknown[]) => void;
  onClose?: (code: number, reason: string) => void;
  onError?: (err: unknown) => void;
  onLog?: (line: string) => void;
};

export type PandoraSocketOptions = {
  /** Default: widget customWebSocketUrl + /socket.io/?EIO=4&transport=websocket */
  url?: string;
  handlers?: PandoraSocketHandlers;
  /** Auto-reconnect (default true). */
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  /** WebSocket constructor (tests). */
  WebSocketImpl?: typeof WebSocket;
};

export function defaultPandoraSocketUrl(): string {
  const base = FANTASY_WIDGET_CONFIG.customWebSocketUrl.replace(/\/$/, "");
  return `${base}/socket.io/?EIO=4&transport=websocket`;
}

export function parseEngineOpen(packet: string): PandoraOpenInfo | null {
  if (!packet.startsWith(EIO.open)) return null;
  try {
    const json = JSON.parse(packet.slice(1)) as Record<string, unknown>;
    const sid = String(json.sid ?? "");
    if (!sid) return null;
    return {
      sid,
      pingInterval: Number(json.pingInterval) || 25_000,
      pingTimeout: Number(json.pingTimeout) || 20_000,
      maxPayload:
        json.maxPayload != null ? Number(json.maxPayload) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Parse Socket.IO EVENT packet: `42["eventName", ...args]` or `42/namespace,["event",...]`.
 * Returns null if not an event packet.
 */
export function parseSocketIoEvent(
  engineMessage: string,
): { eventName: string; args: unknown[] } | null {
  // Engine.IO message wrapper: type "4" + Socket.IO packet
  if (!engineMessage.startsWith(EIO.message)) return null;
  const sio = engineMessage.slice(1);
  // optional nsp: 42/nsp,[...] or 42[...]
  const eventMatch = /^2(?:\/[^,]+,)?(\[.*\])$/.exec(sio);
  if (!eventMatch) return null;
  try {
    const arr = JSON.parse(eventMatch[1]!) as unknown[];
    if (!Array.isArray(arr) || typeof arr[0] !== "string") return null;
    return { eventName: arr[0], args: arr.slice(1) };
  } catch {
    return null;
  }
}

/** Encode Socket.IO emit: 42["name", ...args] as Engine.IO message. */
export function encodeSocketIoEmit(eventName: string, ...args: unknown[]): string {
  return `${EIO.message}${SIO.event}${JSON.stringify([eventName, ...args])}`;
}

export class PandoraSocket {
  private readonly url: string;
  private readonly handlers: PandoraSocketHandlers;
  private readonly reconnect: boolean;
  private readonly maxReconnectAttempts: number;
  private readonly WebSocketImpl: typeof WebSocket;
  private ws: WebSocket | null = null;
  private openInfo: PandoraOpenInfo | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closedByUser = false;
  private reconnectAttempt = 0;
  private namespaceConnected = false;

  constructor(options: PandoraSocketOptions = {}) {
    this.url = options.url ?? defaultPandoraSocketUrl();
    this.handlers = options.handlers ?? {};
    this.reconnect = options.reconnect !== false;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    this.WebSocketImpl = options.WebSocketImpl ?? WebSocket;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.namespaceConnected;
  }

  get sid(): string | null {
    return this.openInfo?.sid ?? null;
  }

  connect(): void {
    this.closedByUser = false;
    this.handlers.onLog?.(`pandora: connecting ${this.url}`);
    const ws = new this.WebSocketImpl(this.url);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.handlers.onLog?.("pandora: websocket open (await Engine.IO 0 packet)");
    });

    ws.addEventListener("message", (ev) => {
      const raw = String((ev as MessageEvent).data ?? "");
      this.handleRaw(raw);
    });

    ws.addEventListener("error", (ev) => {
      this.handlers.onError?.(ev);
    });

    ws.addEventListener("close", (ev) => {
      this.stopPing();
      this.namespaceConnected = false;
      const ce = ev as CloseEvent;
      this.handlers.onClose?.(ce.code, ce.reason ?? "");
      this.ws = null;
      if (!this.closedByUser && this.reconnect) {
        this.scheduleReconnect();
      }
    });
  }

  /** Graceful close (no reconnect). */
  close(): void {
    this.closedByUser = true;
    this.stopPing();
    try {
      this.ws?.close(1000, "client close");
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.namespaceConnected = false;
  }

  /**
   * Emit a Socket.IO event once connected.
   * Subscription shape is **TBD** — e.g. emit("subscribe", { sport: 220 }).
   */
  emit(eventName: string, ...args: unknown[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("pandora: not connected");
    }
    const frame = encodeSocketIoEmit(eventName, ...args);
    this.ws.send(frame);
    this.handlers.onLog?.(`pandora: emit ${eventName} ${frame.slice(0, 120)}`);
  }

  /**
   * Placeholder subscription until Messages tab is captured.
   * Does nothing unless `rawEmit` is provided.
   */
  subscribePlaceholder(options: {
    /** When set, send this exact Engine.IO/Socket.IO frame string */
    rawFrame?: string;
    /** Or emit known event once format is known */
    eventName?: string;
    args?: unknown[];
  } = {}): void {
    if (options.rawFrame) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        throw new Error("pandora: not connected");
      }
      this.ws.send(options.rawFrame);
      this.handlers.onLog?.(`pandora: raw subscribe frame sent`);
      return;
    }
    if (options.eventName) {
      this.emit(options.eventName, ...(options.args ?? []));
      return;
    }
    this.handlers.onLog?.(
      "pandora: subscribePlaceholder no-op — capture widget WS Messages (emit name + payload)",
    );
  }

  private handleRaw(raw: string): void {
    this.handlers.onPacket?.(raw);

    if (raw.startsWith(EIO.open)) {
      const info = parseEngineOpen(raw);
      if (info) {
        this.openInfo = info;
        this.reconnectAttempt = 0;
        this.handlers.onOpen?.(info);
        this.startPing(info.pingInterval);
        // Connect default namespace
        this.ws?.send(`${EIO.message}${SIO.connect}`);
      }
      return;
    }

    if (raw === EIO.ping || raw.startsWith(EIO.ping)) {
      this.ws?.send(EIO.pong);
      return;
    }

    if (raw.startsWith(EIO.message + SIO.connect)) {
      // 40 or 40{"sid":"..."}
      this.namespaceConnected = true;
      let nsSid = "";
      try {
        const rest = raw.slice(2);
        if (rest.startsWith("{")) {
          nsSid = String((JSON.parse(rest) as { sid?: string }).sid ?? "");
        }
      } catch {
        /* ignore */
      }
      this.handlers.onNamespaceConnect?.(nsSid || this.openInfo?.sid || "");
      return;
    }

    const evt = parseSocketIoEvent(raw);
    if (evt) {
      this.handlers.onEvent?.(evt.eventName, evt.args);
    }
  }

  private startPing(intervalMs: number): void {
    this.stopPing();
    // Server also pings us; client-side timer as backup keepalive log only.
    // Responding to server "2" is the required path.
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // optional client ping — some servers expect only response to 2
      }
    }, intervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this.handlers.onLog?.("pandora: max reconnect attempts reached");
      return;
    }
    this.reconnectAttempt++;
    const delay = Math.min(30_000, 500 * 2 ** (this.reconnectAttempt - 1));
    this.handlers.onLog?.(
      `pandora: reconnect in ${delay}ms (attempt ${this.reconnectAttempt})`,
    );
    setTimeout(() => {
      if (!this.closedByUser) this.connect();
    }, delay);
  }
}
