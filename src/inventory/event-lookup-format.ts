/**
 * Human markdown formatters for event-lookup results.
 * Cohesion split: pure format (not plane probe / lookup orchestration).
 */
import type {
  CoefficientLine,
  EventDataBoardScan,
  EventOfferability,
  PandoraBlockedSets,
} from '../partner/fantasy-ultra/coefficients.ts';
import type { OddsWatchSummary } from './pandora-listen.ts';
import {
  pandoraMarketLabel,
  vigFromCoefficientLines,
  type CoefficientLineLike,
} from '../partner/fantasy-ultra/market-decode.ts';
import {
  labelPeriodId,
  type EventLookupResult,
} from './event-lookup.ts';

function mdTable(headers: string[], rows: string[][]): string[] {
  if (!rows.length) return [];
  const cols = headers.length;
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length))
  );
  const pad = (cells: string[]) =>
    '| ' +
    cells
      .map((c, i) => (c ?? '').padEnd(widths[i] ?? 0))
      .join(' | ') +
    ' |';
  const sep =
    '| ' + widths.map(w => '-'.repeat(Math.max(w, 3))).join(' | ') + ' |';
  return [pad(headers), sep, ...rows.map(r => pad(r.slice(0, cols)))];
}

function fmtAm(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`;
}

function fmtDec(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(2);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(2)}%`;
}

/** Project coefficient lines to the vig decoder's minimal shape (sideIndex dropped when absent). */
function coefficientLineLike(lines: CoefficientLine[]): CoefficientLineLike[] {
  return lines.map(l => ({
    period: l.period,
    marketType: l.marketType,
    selection: l.selection,
    decimal: l.decimal,
    ...(l.sideIndex !== undefined ? { sideIndex: l.sideIndex } : {}),
  }));
}

/** Compact price cell: ML pair or first two legs / count. Full detail via --json. */
function marketPriceCell(
  all: CoefficientLine[],
  period: string,
  marketType: string
): string {
  const group = all.filter(
    l => l.period === period && l.marketType === marketType
  );
  if (!group.length) return '—';
  if (marketType === '3' || marketType === '9') {
    const h = group.find(l => l.selection === '1');
    const a = group.find(l => l.selection === '2');
    if (h && a) {
      return `1 ${fmtAm(h.american)} · 2 ${fmtAm(a.american)}`;
    }
  }
  const top = group.slice(0, 3).map(l => `${l.selection}@${fmtDec(l.decimal)}`);
  return top.length ? top.join(' ') : `${group.length} legs`;
}

export function formatEventLookup(r: EventLookupResult): string {
  const lines: string[] = [];
  const es = r.pandora.eventState;
  const matchup =
    es?.home || es?.away
      ? `${es.home ?? '?'} vs ${es.away ?? '?'}`
      : r.streamList.event
        ? `${r.streamList.event.home ?? '?'} vs ${r.streamList.event.away ?? '?'}`
        : '—';

  lines.push(
    `# Event ${r.eventId}` +
      (r.periodId ? ` / ${r.periodId}` : '') +
      (r.sportHint ? ` · ${r.sportHint}` : '')
  );
  lines.push('');
  lines.push(...mdTable(
    ['Field', 'Value'],
    [
      ['Match', matchup],
      [
        'Sport',
        es?.canonicalSportId
          ? `${es.canonicalSportId} · feed=${es.sportId} (${es.sportName ?? '?'})`
          : (es?.sportName ?? r.sportHint ?? '—'),
      ],
      [
        'League',
        es?.leagueName
          ? `${es.leagueName} (${es.leagueId ?? '?'})`
          : (es?.leagueId ?? '—'),
      ],
      [
        'Country',
        es?.countryName
          ? `${es.countryName} (${es.countryId ?? '?'})`
          : (es?.countryId ?? '—'),
      ],
      [
        'State',
        es
          ? `s=${es.state}(${es.stateLabel})` +
            (es.wireState != null && es.wireState !== es.state
              ? ` wire=${es.wireState}`
              : '')
          : '—',
      ],
      [
        'Offer',
        es
          ? `hasLines=${es.hasLines} started=${es.isStarted} OTB=${es.offTheBoard}` +
            (es.blockedReason ? ` ${es.blockedReason}` : '')
          : '—',
      ],
      ['Plane', r.plane],
      ['Path', es?.path?.length ? `s/${es.path.join('/')}` : '—'],
      [
        'Start',
        es?.startTimeSec != null
          ? new Date(es.startTimeSec * 1000).toISOString()
          : '—',
      ],
      ['URL', r.pliveUrl],
      [
        'Book',
        r.pandora.book
          ? `${r.pandora.book.offeredMarketCount} offered / ${r.pandora.book.offMarketCount} off · ${r.pandora.lineCount} lines (${r.pandora.seconds}s)`
          : r.pandora.probed
            ? `${r.pandora.lineCount} lines`
            : 'skipped',
      ],
      [
        'Board',
        r.pandora.eventDataBoard
          ? `sports=${r.pandora.eventDataBoard.sportCount} events=${r.pandora.eventDataBoard.eventCount}`
          : '—',
      ],
      [
        'Inventory',
        r.streamList.hit
          ? `stream-list ✓ ${r.streamList.event?.bucket ?? ''}`
          : 'stream-list ✗',
      ],
      [
        'Catalog',
        r.bookedCatalog
          ? `${r.bookedCatalog.sportName}: ${r.bookedCatalog.name}`
          : '✗',
      ],
    ]
  ));

  if (r.pandora.probed && r.pandora.periods.length) {
    lines.push('');
    lines.push('## Periods');
    lines.push(
      ...mdTable(
        ['Period', 'Label', 'Lines', 'Markets', 'ML (am)', 'Total', 'Spread', 'Focus'],
        r.pandora.periods.map(p => [
          p.periodId,
          p.label,
          String(p.lineCount),
          p.marketTypes
            .map(m => `${m}:${pandoraMarketLabel(m).slice(0, 8)}`)
            .join(', '),
          p.moneyline
            ? `${fmtAm(p.moneyline.homeAmerican)} / ${fmtAm(p.moneyline.awayAmerican)}`
            : '—',
          p.totalLine != null ? String(p.totalLine) : '—',
          p.spreadLine != null ? String(p.spreadLine) : '—',
          r.periodId === p.periodId ? '←' : '',
        ])
      )
    );
  }

  if (r.pandora.probed && r.pandora.book) {
    const b = r.pandora.book;
    const feedId = r.pandora.eventState?.sportId ?? null;
    const periodLabelById = new Map(
      r.pandora.periods.map(p => [p.periodId, p.label] as const)
    );
    const periodCell = (period: string) => {
      const lab =
        periodLabelById.get(period) ??
        labelPeriodId(period, r.sportHint, feedId);
      return lab && lab !== period ? `${period} · ${lab}` : period;
    };
    const vigByKey = new Map(
      vigFromCoefficientLines(coefficientLineLike(r.pandora.lines)).map(
        v => [`${v.period}/${v.marketType}`, v] as const
      )
    );
    const offered = b.markets.filter(m => m.offered);
    if (offered.length) {
      lines.push('');
      const sportCol =
        r.pandora.eventState?.canonicalSportId ??
        r.sportHint ??
        (feedId != null ? String(feedId) : '—');
      lines.push('## Markets (offered)');
      lines.push(
        ...mdTable(
          ['Sport', 'Period', 'Mkt type', 'Name', 'Line (r)', 'Vig', 'cls', 'Prices'],
          offered.slice(0, 24).map(m => {
            const vig = vigByKey.get(`${m.period}/${m.marketType}`);
            return [
              sportCol,
              periodCell(m.period),
              String(m.marketType),
              pandoraMarketLabel(m.marketType),
              m.line != null ? String(m.line) : '—',
              vig ? fmtPct(vig.vigPercent) : '—',
              m.clsDefault != null ? String(m.clsDefault) : '—',
              marketPriceCell(r.pandora.lines, m.period, m.marketType),
            ];
          })
        )
      );
    }
    const off = b.markets.filter(m => !m.offered);
    if (off.length) {
      const sportCol =
        r.pandora.eventState?.canonicalSportId ??
        r.sportHint ??
        (feedId != null ? String(feedId) : '—');
      lines.push('');
      lines.push('## Markets (off / empty o)');
      lines.push(
        ...mdTable(
          ['Sport', 'Period', 'Mkt type', 'Name', 'Line'],
          off.slice(0, 16).map(m => [
            sportCol,
            periodCell(m.period),
            String(m.marketType),
            pandoraMarketLabel(m.marketType),
            m.line != null ? String(m.line) : '—',
          ])
        )
      );
    }
  }

  const feedForLabels = r.pandora.eventState?.sportId ?? null;
  const periodLab = (period: string) =>
    labelPeriodId(period, r.sportHint, feedForLabels);

  if (r.pandora.probed) {
    const vigRows = vigFromCoefficientLines(coefficientLineLike(r.pandora.lines)).slice(0, 12);
    if (vigRows.length) {
      lines.push('');
      lines.push('## Vig (overround)');
      lines.push(
        ...mdTable(
          ['Period', 'Mkt', 'Name', 'Vig', 'Legs'],
          vigRows.map(v => [
            periodLab(v.period),
            String(v.marketType),
            v.label,
            fmtPct(v.vigPercent),
            String(v.prices.length),
          ])
        )
      );
    }
  }

  if (!r.pandora.probed) {
    lines.push('');
    lines.push('_pandora skipped_');
  }
  if (r.notes.length) {
    lines.push('');
    lines.push('## Notes');
    for (const n of r.notes) lines.push(`  · ${n}`);
  }
  lines.push('');
  lines.push(
    'route: /event/:eventId/:periodId? · m=match · inventory≠pandora id space · ezlive shares plive shell'
  );
  return lines.join('\n');
}

export function formatEventBoardScan(
  scan: EventDataBoardScan,
  options: {
    sportFilter?: string | null;
    bettableOnly?: boolean;
    otbOnly?: boolean;
    limit?: number;
    blocked?: PandoraBlockedSets | null;
  } = {}
): string {
  const limit = Math.min(Math.max(options.limit ?? 40, 5), 200);
  const lines: string[] = [];
  const s = scan.summary;
  lines.push(
    `eventData board  sports=${s.sportCount} events=${s.eventCount}  ` +
      `db=${s.dbCount} kb=${s.kbCount}`
  );
  lines.push(
    `  effective: bettableWithLines=${scan.bettableWithLines}  OTB=${scan.offTheBoard}  ` +
      `blockedOverlay=${scan.blockedOverlayCount}`
  );
  lines.push(
    `  byState: ${Object.entries(scan.byState)
      .map(([k, v]) => `${k}=${v}`)
      .join('  ')}`
  );
  if (options.blocked) {
    lines.push(
      `  groupProfile.blocked: sports=[${[...options.blocked.sports].join(',')}]  ` +
        `leagues=${options.blocked.leagues.size}  events=${options.blocked.events.size}`
    );
  }
  lines.push('');
  lines.push('## By feed sport (feed id ≠ widget id)');
  lines.push(
    ...mdTable(
      [
        'Feed',
        'Name',
        'SportId',
        'n',
        'Bettable',
        'Lines',
        'OTB',
        'Fin',
        'NotBett',
      ],
      scan.bySport.slice(0, 24).map(r => [
        r.sportId,
        r.sportName ?? '—',
        r.canonicalSportId ?? '—',
        String(r.total),
        String(r.bettable),
        String(r.hasLines),
        String(r.offTheBoard),
        String(r.finished),
        String(r.notBettable),
      ])
    )
  );

  let list = scan.events;
  if (options.sportFilter) {
    const f = options.sportFilter.trim().toLowerCase();
    list = list.filter(e => {
      if (e.sportId === f || e.sportId === options.sportFilter) return true;
      if (e.canonicalSportId?.toLowerCase() === f) return true;
      if (e.sportName?.toLowerCase() === f) return true;
      if (e.sportName?.toLowerCase().replace(/\s+/g, '_') === f) return true;
      return false;
    });
  }
  if (options.bettableOnly) {
    list = list.filter(e => e.state === 0 && e.hasLines && !e.offTheBoard);
  }
  if (options.otbOnly) {
    list = list.filter(e => e.offTheBoard);
  }
  // prefer interesting first: bettable with lines, then others
  list = [...list].sort((a, b) => {
    const score = (e: EventOfferability) =>
      (e.state === 0 && e.hasLines ? 0 : 10) +
      (e.offTheBoard ? 1 : 0) +
      (e.blockedReason ? 0.5 : 0);
    return score(a) - score(b) || a.eventId - b.eventId;
  });

  lines.push('');
  lines.push(
    `## Events (showing ${Math.min(limit, list.length)}/${list.length}` +
      (options.sportFilter ? ` sport=${options.sportFilter}` : '') +
      (options.bettableOnly ? ' bettable+lines' : '') +
      (options.otbOnly ? ' OTB only' : '') +
      ')'
  );
  lines.push(
    ...mdTable(
      [
        'Event',
        'State',
        'L',
        'OTB',
        'Feed',
        'SportId',
        'League',
        'Match',
      ],
      list.slice(0, limit).map(e => [
        String(e.eventId),
        e.stateLabel,
        e.hasLines == null ? '—' : e.hasLines ? 'Y' : 'N',
        e.offTheBoard ? 'Y' : 'N',
        e.sportId
          ? `${e.sportId}${e.sportName ? ` ${e.sportName}` : ''}`
          : '—',
        e.canonicalSportId ?? '—',
        e.leagueName
          ? e.leagueName.slice(0, 24)
          : (e.leagueId ?? '—'),
        e.home || e.away
          ? `${e.home ?? '?'} vs ${e.away ?? '?'}`
          : '—',
      ])
    )
  );
  lines.push('');
  lines.push('note: feed id ≠ widget sportOrder; blocked → notBettable');
  return lines.join('\n');
}

/** Best-effort c{} tree from extracted lines (for book analysis without raw payload). */

export function formatOddsWatchSummary(s: OddsWatchSummary): string {
  const lines: string[] = [];
  lines.push(`# Watch summary · event ${s.eventId}`);
  lines.push('');
  lines.push(
    ...mdTable(
      ['Metric', 'Value'],
      [
        ['Updates', String(s.updates)],
        ['Lines (last)', String(s.lastLineCount)],
        ['Offered mkts', String(s.lastOfferedMarkets)],
        ['Suspensions closed', String(s.suspensionCount)],
        ['Suspensions open', String(s.openSuspensions)],
        [
          'Median suspend',
          s.medianSuspensionMs != null
            ? `${(s.medianSuspensionMs / 1000).toFixed(1)}s`
            : '—',
        ],
        [
          'Mean suspend',
          s.meanSuspensionMs != null
            ? `${(s.meanSuspensionMs / 1000).toFixed(1)}s`
            : '—',
        ],
      ]
    )
  );
  const tcRows = Object.entries(s.transitionCounts).map(([k, v]) => [
    k,
    String(v),
  ]);
  if (tcRows.length) {
    lines.push('');
    lines.push('## Transitions');
    lines.push(...mdTable(['Kind', 'Count'], tcRows));
  }
  if (s.suspensions.length) {
    lines.push('');
    lines.push('## Suspension intervals');
    lines.push(
      ...mdTable(
        ['Mkt', 'Off', 'On', 'Duration'],
        s.suspensions.slice(0, 20).map(x => [
          `${x.period}/${x.marketType}`,
          x.offAt.replace('T', ' ').replace(/\.\d+Z$/, 'Z'),
          x.onAt
            ? x.onAt.replace('T', ' ').replace(/\.\d+Z$/, 'Z')
            : '—',
          x.durationMs != null
            ? `${(x.durationMs / 1000).toFixed(1)}s`
            : 'open',
        ])
      )
    );
  }
  if (s.byMarketTransitions.length) {
    lines.push('');
    lines.push('## Activity by market');
    lines.push(
      ...mdTable(
        ['Mkt', 'Name', 'Off', 'On', 'Price chg'],
        s.byMarketTransitions.slice(0, 14).map(m => [
          `${m.period}/${m.marketType}`,
          pandoraMarketLabel(m.marketType),
          String(m.off),
          String(m.on),
          String(m.priceChanges),
        ])
      )
    );
  }
  if (s.vig.length) {
    lines.push('');
    lines.push('## Vig (last snapshot)');
    lines.push(
      ...mdTable(
        ['Mkt', 'Name', 'Kind', 'Vig', 'Σ imp', 'Legs'],
        s.vig.slice(0, 12).map(v => [
          `${v.period}/${v.marketType}`,
          v.label,
          v.kind,
          `${v.vigPercent.toFixed(2)}%`,
          v.impliedSum.toFixed(3),
          String(v.prices.length),
        ])
      )
    );
  }
  return lines.join('\n');
}

/**
 * Watch coefficient book + eventData board for offer transitions.
 * Primary market signals: selection_off / market_off.
 * Primary event signals: state s→2|3, hasLines l→false (OTB).
 */

