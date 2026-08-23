/**
 * (Deprecated) ANSI width utilities - SUPERSEDED by
 * src/research/terminal-out.ts, which calls the Bun primitives directly
 * (Bun.stringWidth / Bun.sliceAnsi / Bun.wrapAnsi / Bun.stripANSI).
 *
 * Why: the user asked 'why not just use Bun's utils by default' - and the
 * answer is that terminal-out.ts ALREADY does (32 direct call sites),
 * while these thin wrappers had ZERO production consumers (only the test
 * file imported them). statusLine moved to terminal-out.ts (pitfalls 31).
 *
 * Kept only as a re-export shim for any lingering import; remove once
 * nothing imports it.
 */
export { statusLine, padDisplay as padAnsi, plainDisplay as visibleWidthSafe } from '../research/terminal-out.ts';