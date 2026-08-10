#!/usr/bin/env bun
/**
 * Look up a plive #!/event/{id}[/{period}] across inventory + Pandora.
 *
 *   bun run domain:event -- --id=197548901
 *   bun run domain:event -- --id=197488581 --period=m
 *   bun run domain:event -- --url='https://plive…/live/?#!/event/197488581/m'
 *   bun run domain:event -- --id=197502731 --watch --seconds=30
 *   bun run domain:event -- --sample-sports
 *   bun run domain:event -- --id=197548901 --json
 *
 * Odds off:
 *   market — empty `o` / selection_off / market_off (--watch)
 *   event  — eventData board s=0..3 + l(hasLines); OTB = finished|notBettable|blocked|!hasOdds
 * cls = limit class (not suspend).
 */
import {
  formatEventLookup,
  formatSportBoardSamples,
  lookupEvent,
  parseEventRef,
  sampleStreamListBySport,
  watchEventOdds,
} from '../src/inventory/event-lookup.ts';

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function argValue(name: string): string | undefined {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const json = hasFlag('json');
const sampleSports = hasFlag('sample-sports');
const probePandora = hasFlag('probe-pandora');
const watch = hasFlag('watch');
const seconds =
  Number(
    argValue('seconds') ??
      (watch ? '30' : probePandora ? '3' : '8')
  ) || 8;

if (sampleSports) {
  const samples = await sampleStreamListBySport({
    maxSports: Number(argValue('max') ?? '24') || 24,
    pandoraSeconds: probePandora ? Math.min(seconds, 5) : 0,
  });
  if (json) console.log(JSON.stringify(samples, null, 2));
  else console.log(formatSportBoardSamples(samples));
  process.exit(0);
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
      'usage: bun run domain:event -- --id=<eventId>[/period] | --url=<plive url> | --sample-sports | --watch'
    );
    process.exit(2);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
}

const periodExplicit = argValue('period')?.trim() || null;
const periodId = periodExplicit ?? periodFromRef;
const noPandora = hasFlag('no-pandora');

if (watch) {
  console.error(
    `watching event=${eventId} for ${seconds}s (coeff + eventData state/hasLines)`
  );
  const history = await watchEventOdds(Number(eventId), {
    seconds,
    onUpdate: u => {
      if (json) {
        console.log(JSON.stringify(u));
        return;
      }
      const off = u.transitions.filter(
        t => t.kind === 'market_off' || t.kind === 'selection_off'
      );
      const on = u.transitions.filter(
        t => t.kind === 'market_on' || t.kind === 'selection_on'
      );
      const ch = u.transitions.filter(t => t.kind === 'price_change');
      const es = u.eventState;
      const esPart = es
        ? ` s=${es.state}(${es.stateLabel}) l=${es.hasLines} OTB=${es.offTheBoard}`
        : '';
      console.log(
        `${u.at} lines=${u.lineCount} offeredMkts=${u.offeredMarketCount} ` +
          `off=${off.length} on=${on.length} chg=${ch.length} evt=${u.eventTransitions.length}${esPart}`
      );
      for (const t of u.eventTransitions.slice(0, 12)) {
        if (t.kind === 'lines_flag') {
          console.log(`  event hasLines=${t.hasLines}`);
        } else if (t.kind === 'event_removed') {
          console.log(`  event removed from board`);
        } else {
          console.log(
            `  event ${t.field}: ${t.from ?? '—'}→${JSON.stringify(t.to)}`
          );
        }
      }
      for (const t of u.transitions.slice(0, 20)) {
        if (t.kind === 'price_change') {
          console.log(
            `  price_change ${t.period}/${t.marketType} sel=${t.selection} ${t.from}→${t.to}`
          );
        } else if (t.kind === 'selection_off' || t.kind === 'selection_on') {
          console.log(
            `  ${t.kind} ${t.period}/${t.marketType} sel=${t.selection}`
          );
        } else {
          console.log(`  ${t.kind} ${t.period}/${t.marketType}`);
        }
      }
    },
  });
  if (json) {
    console.log(JSON.stringify({ watch: true, eventId, updates: history.length }, null, 2));
  } else {
    console.log(
      `watch done updates=${history.length} (market_off / hasLines=false / s=2|3 = odds taken off)`
    );
  }
  process.exit(0);
}

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
