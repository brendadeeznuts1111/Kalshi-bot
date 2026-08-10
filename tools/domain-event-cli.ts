#!/usr/bin/env bun
/**
 * Look up a plive #!/event/{id} across inventory + Pandora priced planes.
 *
 *   bun run domain:event -- --id=197548901
 *   bun run domain:event -- --id=197548901 --json
 *   bun run domain:event -- --id=197548901 --seconds=12
 *   bun run domain:event -- --id=197548901 --no-pandora
 */
import {
  formatEventLookup,
  lookupEvent,
} from '../src/inventory/event-lookup.ts';

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function argValue(name: string): string | undefined {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const id =
  argValue('id') ??
  argValue('event') ??
  process.argv.find(a => /^\d{6,}$/.test(a));

if (!id) {
  console.error('usage: bun run domain:event -- --id=<eventId>');
  process.exit(2);
}

const json = hasFlag('json');
const noPandora = hasFlag('no-pandora');
const seconds = Number(argValue('seconds') ?? '8') || 8;

const result = await lookupEvent({
  eventId: id,
  pandoraSeconds: noPandora ? 0 : seconds,
  skipPandora: noPandora,
});

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(formatEventLookup(result));
}

// exit 0 even for priced_only — lookup succeeded
process.exit(0);
