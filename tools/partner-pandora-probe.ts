#!/usr/bin/env bun
/**
 * Probe Pandora Socket.IO handshake / plive subscribe / coefficient ingest.
 *
 *   bun run partner:pandora-probe
 *   bun run partner:pandora-probe -- --seconds=15 --plive
 *   bun run partner:pandora-probe -- --plive --event-ids=174125551,174125552
 *
 * After capturing widget WS Messages, re-run with:
 *   --emit=eventName --arg='{"sport":220}'
 *   --raw='42["subscribe",{"sport":220}]'
 */
import { argValue } from '../src/cli/argv.ts';
import { parseArgs } from 'node:util';
// @see https://bun.com/docs/api/websockets
import { CoefficientStore } from "../src/partner/fantasy-ultra/coefficient-store.ts";
import { PandoraSocket } from "../src/partner/fantasy-ultra/pandora-socket.ts";


const seconds = Math.min(
  Math.max(Number(argValue("seconds") ?? "12") || 12, 3),
  120,
);
const emitName = argValue("emit");
const emitArg = argValue("arg");
const rawFrame = argValue("raw");
const { values: ppv } = parseArgs({ args: Bun.argv.slice(2), options: { plive: { type: 'boolean' } }, strict: false, allowPositionals: true });
const plive = ppv.plive === true;
const eventIdsRaw = argValue("event-ids");
const eventIds = eventIdsRaw
  ? eventIdsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (Number.isFinite(Number(s)) ? Number(s) : s))
  : [];

const packets: string[] = [];
const store = new CoefficientStore();

const sock = new PandoraSocket({
  handlers: {
    onLog: (l) => console.error(l),
    onOpen: (info) => {
      console.log(
        JSON.stringify({
          phase: "engine_open",
          sid: info.sid,
          pingInterval: info.pingInterval,
        }),
      );
    },
    onNamespaceConnect: (sid) => {
      console.log(JSON.stringify({ phase: "sio_connect", sid }));
      try {
        if (rawFrame) sock.subscribePlaceholder({ rawFrame });
        else if (emitName) {
          const args = emitArg ? [JSON.parse(emitArg)] : [];
          sock.subscribePlaceholder({ eventName: emitName, args });
        } else if (plive || eventIds.length > 0) {
          sock.subscribeLive({ eventIds });
        } else {
          sock.subscribePlaceholder();
        }
      } catch (e) {
        console.error(e);
      }
    },
    onPacket: (raw) => {
      packets.push(raw);
      const preview = raw.length > 180 ? raw.slice(0, 180) + "…" : raw;
      console.log(JSON.stringify({ phase: "packet", preview }));
    },
    onEvent: (name, args) => {
      console.log(JSON.stringify({ phase: "event", name, args }, null, 0));
    },
    onCoefficients: (info) => {
      const lines = store.ingest(info);
      console.log(
        JSON.stringify({
          phase: "coefficients",
          room: info.room,
          eventId: info.eventId,
          isDiff: info.envelope.isDiff,
          lines: lines.length,
          pricedEvents: store.pricedEventCount(),
          markets: store.toPartnerMarkets().map((m) => ({
            ticker: m.ticker,
            home: m.homePrice,
            away: m.awayPrice,
          })),
        }),
      );
    },
    onClose: (code, reason) => {
      console.log(
        JSON.stringify({
          phase: "close",
          code,
          reason,
          packetCount: packets.length,
          pricedEvents: store.pricedEventCount(),
          lineCount: store.lineCount(),
        }),
      );
    },
    onError: (err) => console.error("error", err),
  },
  reconnect: false,
});

sock.connect();
await Bun.sleep(seconds * 1000);
sock.close();
console.log(
  JSON.stringify({
    done: true,
    packets: packets.length,
    pricedEvents: store.pricedEventCount(),
    lineCount: store.lineCount(),
    marketTickers: store.toPartnerMarkets().map((m) => m.ticker),
  }),
);
