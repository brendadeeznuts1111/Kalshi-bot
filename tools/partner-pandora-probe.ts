#!/usr/bin/env bun
/**
 * Probe Pandora Socket.IO handshake (no subscription — format TBD).
 *
 *   bun run partner:pandora-probe
 *   bun run partner:pandora-probe -- --seconds=15
 *
 * After capturing widget WS Messages, re-run with:
 *   --emit=eventName --arg='{"sport":220}'
 *   --raw='42["subscribe",{"sport":220}]'
 */
// @see https://bun.com/docs/api/websockets
import { PandoraSocket } from "../src/partner/fantasy-ultra/pandora-socket.ts";

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const seconds = Math.min(Math.max(Number(argValue("seconds") ?? "12") || 12, 3), 120);
const emitName = argValue("emit");
const emitArg = argValue("arg");
const rawFrame = argValue("raw");
const plive = process.argv.includes("--plive");

const packets: string[] = [];

const sock = new PandoraSocket({
  handlers: {
    onLog: (l) => console.error(l),
    onOpen: (info) => {
      console.log(
        JSON.stringify({ phase: "engine_open", sid: info.sid, pingInterval: info.pingInterval }),
      );
    },
    onNamespaceConnect: (sid) => {
      console.log(JSON.stringify({ phase: "sio_connect", sid }));
      try {
        if (rawFrame) sock.subscribePlaceholder({ rawFrame });
        else if (emitName) {
          const args = emitArg ? [JSON.parse(emitArg)] : [];
          sock.subscribePlaceholder({ eventName: emitName, args });
        } else if (plive) {
          sock.subscribeLive();
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
    onClose: (code, reason) => {
      console.log(JSON.stringify({ phase: "close", code, reason, packetCount: packets.length }));
    },
    onError: (err) => console.error("error", err),
  },
  reconnect: false,
});

sock.connect();
await Bun.sleep(seconds * 1000);
sock.close();
console.log(JSON.stringify({ done: true, packets: packets.length }));
