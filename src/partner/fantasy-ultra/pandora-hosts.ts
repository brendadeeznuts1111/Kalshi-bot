/**
 * Pandora / Spandora Socket.IO hosts (same LINE_SET / protocol / diff format).
 *
 * Observed:
 *   plive.sportswidgets.pro     → wss://pandora.ganchrow.com
 *   sportswidgets.pro (public)  → wss://spandora.ganchrow.com  ("s" prefix)
 *
 * mainapp isTableTennis: Number(e)===93 (feed sport id on eventData board).
 */

export const PANDORA_HOSTS = {
  /** Default desk / plive shell. */
  pandora: 'wss://pandora.ganchrow.com',
  /** Public sportswidgets.pro shell (same platform). */
  spandora: 'wss://spandora.ganchrow.com',
} as const;

export type PandoraHostId = keyof typeof PANDORA_HOSTS;

/** Base64 channel segment after live.main. — LINE_SET → "SEVSSVRBR0U=" brand token. */
export const PANDORA_LINE_SET_TOKEN = 'U0VWU1NWUkJSMFU9' as const;

/** Feed sport id on eventData board / live.sports (mainapp isTableTennis). */
export const FEED_SPORT_TABLE_TENNIS = 93 as const;
/** Feed sport id for tennis on live board (not ticket apiSportId=2). */
export const FEED_SPORT_TENNIS = 8 as const;

export function isPandoraHostId(raw: string): raw is PandoraHostId {
  return raw === 'pandora' || raw === 'spandora';
}

export function resolvePandoraHostId(
  raw: string | null | undefined
): PandoraHostId {
  const s = (raw ?? 'pandora').trim().toLowerCase();
  if (s === 's' || s === 'spandora' || s.includes('spandora')) return 'spandora';
  return 'pandora';
}

/** Base wss URL without /socket.io path. */
export function pandoraBaseUrl(host: PandoraHostId = 'pandora'): string {
  return PANDORA_HOSTS[host];
}

/** Full Engine.IO websocket URL. */
export function pandoraSocketUrl(host: PandoraHostId = 'pandora'): string {
  return `${PANDORA_HOSTS[host].replace(/\/$/, '')}/socket.io/?EIO=4&transport=websocket`;
}
