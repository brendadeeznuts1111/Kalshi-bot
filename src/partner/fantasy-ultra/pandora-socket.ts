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
 * Subscription sequence: captured via Bun.WebView CDP
 * (`partner:webview-ws-capture`) — see {@link buildPliveSubscribeSequence}.
 * Odds bodies arrive as Socket.IO binary attachments (`451-` + gzip JSON);
 * see {@link decodePandoraAttachment} / {@link extractCoefficientLines}.
 */
import {
  decodePandoraAttachment,
  eventIdFromCoefficientRoom,
  extractCoefficientLines,
  parseBinaryEventHeader,
  type CoefficientEnvelope,
  type CoefficientLine,
} from './coefficients.ts';
import { FANTASY_WIDGET_CONFIG } from './widget-config.ts';

/** Engine.IO packet types (EIO=4). */
export const EIO = {
  open: '0',
  close: '1',
  ping: '2',
  pong: '3',
  message: '4',
  upgrade: '5',
  noop: '6',
} as const;

/** Socket.IO packet types (inside Engine.IO message). */
export const SIO = {
  connect: '0',
  disconnect: '1',
  event: '2',
  ack: '3',
  connectError: '4',
  binaryEvent: '5',
  binaryAck: '6',
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
   */
  onEvent?: (eventName: string, args: unknown[]) => void;
  /**
   * Decoded eventCoefficients attachment (full snapshot or diff envelope).
   * `lines` is empty for diffs / non-coefficient rooms.
   */
  onCoefficients?: (info: {
    room: string;
    eventId: number | null;
    envelope: CoefficientEnvelope;
    lines: CoefficientLine[];
  }) => void;
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
  const base = FANTASY_WIDGET_CONFIG.customWebSocketUrl.replace(/\/$/, '');
  return `${base}/socket.io/?EIO=4&transport=websocket`;
}

/**
 * Subscription sequence captured via Bun.WebView CDP on plive.sportswidgets.pro
 * (anonymous session: partnerId 118, groupId 97360).
 *
 * Channel prefix `U0VWU1NWUkJSMFU9` base64-decodes to brand token (→ HERITAGE).
 * Odds rooms look like:
 *   live.main.{TOKEN}.eventCoefficients.{eventId}
 */
export type PandoraLiveSessionIds = {
  partnerId?: string;
  groupId?: number | string;
  /** Base64 channel segment after live.main. */
  mainToken?: string;
  /** Optional event ids to subscribe for coefficients */
  eventIds?: Array<string | number>;
};

export const PANDORA_DEFAULT_SESSION: Required<
  Pick<PandoraLiveSessionIds, 'partnerId' | 'groupId' | 'mainToken'>
> = {
  partnerId: '118',
  groupId: 97360,
  mainToken: 'U0VWU1NWUkJSMFU9',
};

/** Build the emit sequence observed after Socket.IO connect on plive. */
export function buildPliveSubscribeSequence(
  ids: PandoraLiveSessionIds = {}
): Array<{ eventName: string; args: unknown[] }> {
  const partnerId = ids.partnerId ?? PANDORA_DEFAULT_SESSION.partnerId;
  const groupId = ids.groupId ?? PANDORA_DEFAULT_SESSION.groupId;
  const mainToken = ids.mainToken ?? PANDORA_DEFAULT_SESSION.mainToken;
  const main = `live.main.${mainToken}`;

  const rooms: string[] = [
    `live.groupProfile.${groupId}`,
    'all.translations',
    'live.sportPeriod',
    `live.fixedParlay.${partnerId}`,
    `live.circle.${partnerId}`,
    `live.featuredBet.${partnerId}`,
    'live.appVersion',
    `live.activeCircle.${groupId}`,
    `${main}.eventData`,
    `${main}.user.alphas.0`,
    `${main}.group.alphas.${groupId}`,
    `${main}.partner.alphas.${partnerId}`,
    'live.countries',
    'live.leagues',
    'live.sports',
    'live.wagerTypes',
  ];

  for (const eid of ids.eventIds ?? []) {
    rooms.push(`${main}.eventCoefficients.${eid}`);
  }

  return [
    {
      eventName: 'setSocketMetadata',
      args: [{ partnerId, flavor: 'live' }],
    },
    {
      eventName: 'subscribeSystemEvents',
      args: [{ partnerId, groupId }],
    },
    ...rooms.map(room => ({
      eventName: 'subscribe',
      args: [[room]],
    })),
  ];
}

export function parseEngineOpen(packet: string): PandoraOpenInfo | null {
  if (!packet.startsWith(EIO.open)) return null;
  try {
    const json = JSON.parse(packet.slice(1)) as Record<string, unknown>;
    const sid = String(json.sid ?? '');
    if (!sid) return null;
    return {
      sid,
      pingInterval: Number(json.pingInterval) || 25_000,
      pingTimeout: Number(json.pingTimeout) || 20_000,
      maxPayload: json.maxPayload != null ? Number(json.maxPayload) : undefined,
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
  engineMessage: string
): { eventName: string; args: unknown[] } | null {
  // Engine.IO message wrapper: type "4" + Socket.IO packet
  if (!engineMessage.startsWith(EIO.message)) return null;
  const sio = engineMessage.slice(1);
  // optional nsp: 42/nsp,[...] or 42[...]
  const eventMatch = /^2(?:\/[^,]+,)?(\[.*\])$/.exec(sio);
  if (!eventMatch) return null;
  try {
    const arr = JSON.parse(eventMatch[1]!) as unknown[];
    if (!Array.isArray(arr) || typeof arr[0] !== 'string') return null;
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
  /** Pending Socket.IO binary attachments after a `451-` header. */
  private pendingBinary: {
    remaining: number;
    eventName: string;
  } | null = null;

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

    ws.addEventListener('open', () => {
      this.handlers.onLog?.('pandora: websocket open (await Engine.IO 0 packet)');
    });

    ws.addEventListener('message', (ev) => {
      const data = (ev as MessageEvent).data;
      if (data instanceof ArrayBuffer) {
        this.handleBinaryAttachment(new Uint8Array(data));
        return;
      }
      if (ArrayBuffer.isView(data)) {
        this.handleBinaryAttachment(
          new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        );
        return;
      }
      if (typeof Blob !== 'undefined' && data instanceof Blob) {
        void data.arrayBuffer().then((ab) => {
          this.handleBinaryAttachment(new Uint8Array(ab));
        });
        return;
      }
      this.handleRaw(String(data ?? ''));
    });

    ws.addEventListener('error', ev => {
      this.handlers.onError?.(ev);
    });

    ws.addEventListener('close', ev => {
      this.stopPing();
      this.namespaceConnected = false;
      const ce = ev as CloseEvent;
      this.handlers.onClose?.(ce.code, ce.reason ?? '');
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
      this.ws?.close(1000, 'client close');
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.namespaceConnected = false;
  }

  /** Emit a Socket.IO event once connected (e.g. subscribe / setSocketMetadata). */
  emit(eventName: string, ...args: unknown[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('pandora: not connected');
    }
    const frame = encodeSocketIoEmit(eventName, ...args);
    this.ws.send(frame);
    this.handlers.onLog?.(`pandora: emit ${eventName} ${frame.slice(0, 120)}`);
  }

  /**
   * Subscribe using captured plive sequence (setSocketMetadata + rooms).
   * For odds, pass eventIds → live.main.{token}.eventCoefficients.{id}
   */
  subscribeLive(ids: PandoraLiveSessionIds = {}): void {
    const seq = buildPliveSubscribeSequence(ids);
    for (const step of seq) {
      this.emit(step.eventName, ...step.args);
    }
    this.handlers.onLog?.(
      `pandora: subscribeLive sent ${seq.length} emits (partner=${ids.partnerId ?? PANDORA_DEFAULT_SESSION.partnerId})`
    );
  }

  /**
   * Low-level: raw frame or single emit (debug / probe CLI).
   */
  subscribePlaceholder(
    options: {
      rawFrame?: string;
      eventName?: string;
      args?: unknown[];
      /** If true, run full plive subscribe sequence */
      plive?: boolean;
      session?: PandoraLiveSessionIds;
    } = {}
  ): void {
    if (options.plive) {
      this.subscribeLive(options.session);
      return;
    }
    if (options.rawFrame) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        throw new Error('pandora: not connected');
      }
      this.ws.send(options.rawFrame);
      this.handlers.onLog?.(`pandora: raw subscribe frame sent`);
      return;
    }
    if (options.eventName) {
      this.emit(options.eventName, ...(options.args ?? []));
      return;
    }
    this.handlers.onLog?.('pandora: use subscribeLive() or --plive on partner:pandora-probe');
  }

  private handleBinaryAttachment(body: Uint8Array | string): void {
    const pending = this.pendingBinary;
    if (!pending) {
      // Text frame that looks like base64 gzip without a header (CDP-style).
      if (typeof body === 'string' && body.startsWith('H4sI')) {
        this.consumeAttachmentBody(body, 'unknown');
      }
      return;
    }
    pending.remaining -= 1;
    if (pending.remaining <= 0) this.pendingBinary = null;
    this.consumeAttachmentBody(body, pending.eventName);
  }

  private consumeAttachmentBody(
    body: Uint8Array | string,
    room: string,
  ): void {
    try {
      const envelope = decodePandoraAttachment(body);
      const eventId = eventIdFromCoefficientRoom(room);
      const lines =
        !envelope.isDiff && eventId != null
          ? extractCoefficientLines(eventId, envelope.payload)
          : [];
      this.handlers.onCoefficients?.({ room, eventId, envelope, lines });
      if (lines.length > 0) {
        this.handlers.onLog?.(
          `pandora: coefficients ${room} lines=${lines.length}`,
        );
      }
    } catch (err) {
      this.handlers.onError?.(err);
      this.handlers.onLog?.(
        `pandora: attachment decode failed for ${room}: ${String(err)}`,
      );
    }
  }

  private handleRaw(raw: string): void {
    this.handlers.onPacket?.(raw);

    // Socket.IO binary event header — next N frames are attachments.
    const binHeader = parseBinaryEventHeader(raw);
    if (binHeader) {
      this.pendingBinary = {
        remaining: binHeader.attachmentCount,
        eventName: binHeader.eventName,
      };
      this.handlers.onEvent?.(binHeader.eventName, binHeader.args);
      return;
    }

    // Some transports deliver the gzip body as a text WS frame (base64).
    if (this.pendingBinary && raw.startsWith('H4sI')) {
      this.handleBinaryAttachment(raw);
      return;
    }

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
      let nsSid = '';
      try {
        const rest = raw.slice(2);
        if (rest.startsWith('{')) {
          nsSid = String((JSON.parse(rest) as { sid?: string }).sid ?? '');
        }
      } catch {
        /* ignore */
      }
      this.handlers.onNamespaceConnect?.(nsSid || this.openInfo?.sid || '');
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
      this.handlers.onLog?.('pandora: max reconnect attempts reached');
      return;
    }
    this.reconnectAttempt++;
    const delay = Math.min(30_000, 500 * 2 ** (this.reconnectAttempt - 1));
    this.handlers.onLog?.(`pandora: reconnect in ${delay}ms (attempt ${this.reconnectAttempt})`);
    setTimeout(() => {
      if (!this.closedByUser) this.connect();
    }, delay);
  }
}
