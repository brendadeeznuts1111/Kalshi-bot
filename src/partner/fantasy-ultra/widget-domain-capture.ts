/**
 * Pandora capture for widget domain rooms (sports / leagues / wagerTypes).
 * Domain parsers live in `src/domain/widget-domain-extract.ts` (no partner deps).
 */
// @see https://bun.com/docs/api/websockets
import {
  extractWidgetDomain,
  type ExtractWidgetDomainOptions,
  type WidgetDomainSnapshot,
} from '../../domain/widget-domain-extract.ts';
import type { CoefficientEnvelope } from './coefficients.ts';
import { PandoraSocket } from './pandora-socket.ts';

export type PandoraDomainRooms = {
  sports: unknown | null;
  leagues: unknown | null;
  wagerTypes: unknown | null;
  seconds: number;
};

/**
 * Subscribe plive sequence and collect decoded room payloads.
 */
export async function capturePandoraDomainRooms(
  options: {
    seconds?: number;
    WebSocketImpl?: typeof WebSocket;
  } = {}
): Promise<PandoraDomainRooms> {
  const seconds = Math.min(Math.max(options.seconds ?? 12, 3), 60);
  const sportsBox: { v: unknown | null } = { v: null };
  const leaguesBox: { v: unknown | null } = { v: null };
  const wagerBox: { v: unknown | null } = { v: null };

  await new Promise<void>((resolve, reject) => {
    const sock = new PandoraSocket({
      reconnect: false,
      WebSocketImpl: options.WebSocketImpl,
      handlers: {
        onNamespaceConnect: () => {
          try {
            sock.subscribeLive({});
          } catch (e) {
            reject(e);
          }
        },
        onCoefficients: (info: {
          room: string;
          envelope: CoefficientEnvelope;
        }) => {
          const p = info.envelope?.payload;
          if (info.room === 'live.sports' && p != null) sportsBox.v = p;
          if (info.room === 'live.leagues' && p != null) leaguesBox.v = p;
          if (info.room === 'live.wagerTypes' && p != null) wagerBox.v = p;
        },
        onError: () => {
          /* keep waiting */
        },
      },
    });
    sock.connect();
    setTimeout(() => {
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      resolve();
    }, seconds * 1000);
  });

  return {
    sports: sportsBox.v,
    leagues: leaguesBox.v,
    wagerTypes: wagerBox.v,
    seconds,
  };
}

/** Shell HTML + optional Pandora capture → domain snapshot. */
export async function extractWidgetDomainWithPandora(
  options: ExtractWidgetDomainOptions & {
    pandora?: boolean;
    pandoraSeconds?: number;
    WebSocketImpl?: typeof WebSocket;
  } = {}
): Promise<WidgetDomainSnapshot> {
  let pandoraRooms = options.pandoraRooms;
  if (!pandoraRooms && options.pandora !== false) {
    try {
      const rooms = await capturePandoraDomainRooms({
        seconds: options.pandoraSeconds,
        WebSocketImpl: options.WebSocketImpl,
      });
      pandoraRooms = {
        sports: rooms.sports ?? undefined,
        leagues: rooms.leagues ?? undefined,
        wagerTypes: rooms.wagerTypes ?? undefined,
      };
    } catch {
      pandoraRooms = undefined;
    }
  }
  return extractWidgetDomain({
    ...options,
    pandoraRooms,
  });
}
