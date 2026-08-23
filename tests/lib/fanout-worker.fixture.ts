/** Worker fixture: posts a release event on the fan-out channel. */
import { createFanout } from "../../src/lib/fanout.ts";
const bus = createFanout("kalshi-bot:bun-release");
bus.post({ type: "bun-release", version: "9.9", title: "Bun 9.9 (fixture)", present: 1, absent: 0 });
bus.close();
