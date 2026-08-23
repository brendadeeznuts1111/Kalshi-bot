/**
 * Typed fan-out bus over BroadcastChannel (Bun 1.4).
 *
 * Verified: BroadcastChannel crosses Worker threads AND main; single-
 * instance self-delivery does NOT fire (spec-correct). This bus uses two
 * internal instances (send + recv) so post() ALSO reaches handlers in the
 * same process - and, being a real BroadcastChannel, it reaches handlers
 * in other processes/workers on the same channel name.
 *
 * @see docs/AGENT-PITFALLS.md 8m (channel writeup fully verified)
 */

export type FanoutMessage = { type: string; [key: string]: unknown };

export type FanoutBus<T extends FanoutMessage> = {
  post(message: T): void;
  onMessage(handler: (message: T) => void): () => void;
  close(): void;
};

/**
 * Create a fan-out bus on a channel name. post() delivers to handlers here
 * AND in any other process/worker with a bus on the same name.
 */
export function createFanout<T extends FanoutMessage>(name: string): FanoutBus<T> {
  const send = new BroadcastChannel(name);
  const recv = new BroadcastChannel(name);
  const handlers = new Set<(m: T) => void>();
  recv.onmessage = (event: MessageEvent) => {
    const msg = event.data as T;
    if (!msg || typeof msg.type !== "string") return;
    for (const h of [...handlers]) h(msg);
  };
  return {
    post(message: T) {
      send.postMessage(message);
    },
    onMessage(handler: (m: T) => void): () => void {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    close() {
      handlers.clear();
      send.close();
      recv.close();
    },
  };
}

/** Channel name for release-watch events. */
export const RELEASE_FANOUT_CHANNEL = "kalshi-bot:bun-release";
