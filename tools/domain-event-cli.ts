#!/usr/bin/env bun
/**
 * Look up a plive #!/event/{id}[/{period}] across inventory + Pandora.
 *
 *   bun run domain:event -- --id=197548901
 *   bun run domain:event -- --id=197488581 --period=m
 *   bun run domain:event -- --id=197488581/m
 *   bun run domain:event -- --url='https://plive.sportswidgets.pro/live/?#!/event/197488581/m'
 *   bun run domain:event -- --id=197548901 --json
 *   bun run domain:event -- --id=197548901 --seconds=12
 *   bun run domain:event -- --id=197548901 --no-pandora
 */
import {
  formatEventLookup,
  lookupEvent,
  parseEventRef,
} from '../src/inventory/event-lookup.ts';

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function argValue(name: string): string | undefined {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const urlArg = argValue('url');
const idArg =
  argValue('id') ??
  argValue('event') ??
  process.argv.find(a => /^\d{5,}(\/[A-Za-z0-9_-]+)?$/.test(a));

let eventId: string;
let periodFromRef: string | null = null;

try {
  if (urlArg) {
    const parsed = parseEventRef(urlArg);
    eventId = parsed.eventId;
    periodFromRef = parsed.periodId;
  } else if (idArg) {
    const parsed = parseEventRef(idArg);
    eventId = parsed.eventId;
    periodFromRef = parsed.periodId;
  } else {
    console.error(
      'usage: bun run domain:event -- --id=<eventId>[/period] | --url=<plive event url>'
    );
    process.exit(2);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
}

const periodExplicit = argValue('period')?.trim() || null;
const periodId = periodExplicit ?? periodFromRef;

const json = hasFlag('json');
const noPandora = hasFlag('no-pandora');
const seconds = Number(argValue('seconds') ?? '8') || 8;

const result = await lookupEvent({
  eventId,
  periodId,
  pandoraSeconds: noPandora ? 0 : seconds,
  skipPandora: noPandora,
});

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(formatEventLookup(result));
}

process.exit(0);
