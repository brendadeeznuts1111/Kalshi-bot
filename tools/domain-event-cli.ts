#!/usr/bin/env bun
/**
 * Look up a plive #!/event/{id}[/{period}] across inventory + Pandora.
 *
 *   bun run domain:event -- --id=197548901
 *   bun run domain:event -- --id=197488581 --period=m
 *   bun run domain:event -- --url='https://plive…/live/?#!/event/197488581/m'
 *   bun run domain:event -- --id=197502731 --watch --seconds=30
 *   bun run domain:event -- --board
 *   bun run domain:event -- --board --bettable --sport=8
 *   bun run domain:event -- --board --spandora --sport=93
 *   bun run domain:event -- --id=197501721 --spandora
 *   bun run domain:event -- --id=197488581 --validate
 *   bun run domain:event -- --id=197488581 --validate-session --renew
 *   bun run domain:event -- --sample-sports
 *   bun run domain:event -- --id=197548901 --json
 *
 * Hosts: --spandora | --host=spandora (public sportswidgets) vs default pandora (plive).
 * Feed sport 93 = table tennis (mainapp isTableTennis).
 *
 * Odds off:
 *   market — empty `o` / selection_off / market_off (--watch)
 *   event  — eventData board s=0..3 + l(hasLines); groupProfile blocked → notBettable
 *   board  — full scan: by-state / by-sport / OTB list
 * validate — market first, then optional seat session (FANTASY402_*)
 * cls = limit class (not suspend).
 */
import {
  formatEventBoardScan,
  formatEventLookup,
  formatOddsWatchSummary,
} from '../src/inventory/event-lookup-format.ts';
import {
  lookupEvent,
  parseEventRef,
} from '../src/inventory/event-lookup.ts';
import {
  formatSportBoardSamples,
  sampleStreamListBySport,
} from '../src/inventory/sports-inventory.ts';
import {
  scanPandoraEventBoard,
  summarizeOddsWatch,
  watchEventOdds,
} from '../src/inventory/pandora-listen.ts';
import {
  formatEventValidate,
  validateEvent,
} from '../src/inventory/event-validate.ts';
import { resolvePandoraHostId } from '../src/partner/fantasy-ultra/pandora-hosts.ts';

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function argValue(name: string): string | undefined {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const json = hasFlag('json');
const sampleSports = hasFlag('sample-sports');
const board = hasFlag('board');
const probePandora = hasFlag('probe-pandora');
const watch = hasFlag('watch');
const pandoraHost = resolvePandoraHostId(
  hasFlag('spandora') ? 'spandora' : argValue('host')
);
const seconds =
  Number(
    argValue('seconds') ??
      (watch ? '30' : board ? '10' : probePandora ? '3' : '8')
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

if (board) {
  console.error(
    `scanning eventData board host=${pandoraHost} for ${seconds}s…`
  );
  const { scan, blocked, sportsNames, seconds: took, host } =
    await scanPandoraEventBoard({ seconds, pandoraHost });
  if (!scan) {
    console.error('no eventData board snapshot received');
    process.exit(1);
  }
  if (json) {
    console.log(
      JSON.stringify(
        {
          host,
          seconds: took,
          sportsNames: Object.fromEntries(sportsNames),
          blocked: blocked
            ? {
                sports: [...blocked.sports],
                leagues: [...blocked.leagues],
                events: [...blocked.events],
                markets: [...blocked.markets],
              }
            : null,
          summary: scan.summary,
          byState: scan.byState,
          bySport: scan.bySport,
          bettableWithLines: scan.bettableWithLines,
          offTheBoard: scan.offTheBoard,
          blockedOverlayCount: scan.blockedOverlayCount,
          events: scan.events,
        },
        null,
        2
      )
    );
  } else {
    console.log(`host=${host}`);
    console.log(
      formatEventBoardScan(scan, {
        sportFilter: argValue('sport') ?? null,
        bettableOnly: hasFlag('bettable'),
        otbOnly: hasFlag('otb'),
        limit: Number(argValue('limit') ?? '40') || 40,
        blocked,
      })
    );
  }
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
      'usage: bun run domain:event -- --id=<eventId>[/period] | --url=… | --board | --validate | --validate-session | --sample-sports | --watch'
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
const validate =
  hasFlag('validate') ||
  hasFlag('validate-session') ||
  hasFlag('validate-market');
const requireSession = hasFlag('validate-session');

if (validate) {
  console.error(
    `validating event=${eventId}` +
      (requireSession ? ' (session required)' : ' (session if FANTASY402_* present)') +
      ` pandora=${seconds}s`
  );
  const report = await validateEvent({
    eventId,
    periodId,
    pandoraSeconds: noPandora ? 0 : Math.max(seconds, 8),
    requireSession,
    renew: hasFlag('renew'),
    envPrefix: argValue('prefix'),
    accountId: argValue('out') ?? argValue('account'),
    pandoraHost,
  });
  if (json) {
    // Drop full lookup body by default noise; include compact market snapshot
    const { lookup, ...rest } = report;
    console.log(
      JSON.stringify(
        {
          ...rest,
          marketSnapshot: {
            plane: lookup.plane,
            sportHint: lookup.sportHint,
            lineCount: lookup.pandora.lineCount,
            eventState: lookup.pandora.eventState,
            book: lookup.pandora.book
              ? {
                  offeredMarketCount: lookup.pandora.book.offeredMarketCount,
                  offMarketCount: lookup.pandora.book.offMarketCount,
                  lineCount: lookup.pandora.book.lineCount,
                }
              : null,
          },
        },
        null,
        2
      )
    );
  } else {
    console.log(formatEventValidate(report));
  }
  const exit =
    report.failedPlanes.includes('market') ||
    report.failedPlanes.includes('profile') ||
    (requireSession && report.failedPlanes.includes('session'))
      ? 1
      : 0;
  process.exit(exit);
}

if (watch) {
  console.error(
    `watching event=${eventId} host=${pandoraHost} for ${seconds}s (coeff + suspensions + vig)`
  );
  const history = await watchEventOdds(Number(eventId), {
    seconds,
    pandoraHost,
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
  const summary = summarizeOddsWatch(history, {
    lastLines: history.lastLines,
  });
  if (json) {
    console.log(
      JSON.stringify(
        {
          watch: true,
          eventId,
          host: pandoraHost,
          updates: history.length,
          summary,
        },
        null,
        2
      )
    );
  } else {
    console.log(formatOddsWatchSummary(summary));
  }
  process.exit(0);
}

const result = await lookupEvent({
  eventId,
  periodId,
  pandoraSeconds: noPandora ? 0 : seconds,
  skipPandora: noPandora,
  pandoraHost,
});

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(formatEventLookup(result));
}

process.exit(0);
