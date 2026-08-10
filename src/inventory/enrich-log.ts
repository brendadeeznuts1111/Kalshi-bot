/**
 * Structured JSON-line logs for inventory enrich (ops / agents).
 */
type EnrichLogLevel = 'info' | 'warn' | 'error';

export function enrichLog(
  level: EnrichLogLevel,
  msg: string,
  meta: Record<string, unknown> = {}
): void {
  const line = JSON.stringify({
    level,
    msg,
    plane: 'inventory',
    component: 'enrich',
    ts: Date.now(),
    ...meta,
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
