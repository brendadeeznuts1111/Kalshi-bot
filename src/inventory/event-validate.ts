/**
 * Market-first validation for a Pandora event id, with optional seat session probe.
 *
 * Planes (never collapse):
 *   inventory — stream-list / skin_events (public)
 *   market    — eventData state + eventCoefficients book (anonymous Pandora)
 *   profile   — groupProfile.blocked overlay (from market probe)
 *   session   — login / warm / renew (needs FANTASY402_* ; optional)
 *
 *   bun run domain:event -- --id=197488581 --validate
 *   bun run domain:event -- --id=197488581 --validate-session
 */
import {
  FantasyUltraAdapter,
  getFantasySessionAdapter,
  loadFantasy402ProfileFromEnv,
  loadFantasy402ProfileFromPrefix,
} from '../partner/index.ts';
import { PANDORA_EVENT_STATES } from '../partner/fantasy-ultra/coefficients.ts';
import {
  lookupEvent,
  type EventLookupResult,
} from './event-lookup.ts';

export type PlaneStatus = 'ok' | 'fail' | 'warn' | 'skip';

export type PlaneResult = {
  status: PlaneStatus;
  /** Short machine code for agents. */
  code: string;
  notes: string[];
};

export type EventValidateReport = {
  eventId: string;
  periodId: string | null;
  pliveUrl: string;
  /** Market first; session only if creds (or required). */
  planes: {
    inventory: PlaneResult;
    market: PlaneResult;
    profile: PlaneResult;
    session: PlaneResult;
  };
  /** Ordered list of planes that failed (market before session). */
  failedPlanes: Array<'inventory' | 'market' | 'profile' | 'session'>;
  /**
   * Primary operator verdict:
   *   market_off — OTB / no lines / missing event (fix session)
   *   market_ok  — bettable + has lines (session may still fail)
   *   market_ok_session_fail — market good, seat weak
   *   market_ok_session_ok — both green
   *   market_ok_session_skip — market good, no creds
   *   market_blocked — partner blocked overlay
   */
  verdict: string;
  lookup: EventLookupResult;
  session: {
    attempted: boolean;
    required: boolean;
    accountId: string | null;
    domain: string | null;
    tokenPresent: boolean;
    tokenLen: number;
    loginOk: boolean;
    warmed: boolean | null;
    cookieCount: number | null;
    renewOk: boolean | null;
    placeBetUrlSet: boolean;
    /** Redacted desktop live URL keys only. */
    liveDesktopHost: string | null;
  } | null;
};

export type EventValidateOptions = {
  eventId: string | number;
  periodId?: string | null;
  pandoraSeconds?: number;
  /**
   * When true, missing FANTASY402_* is a session **fail** (not skip).
   * When false, session is skip if no env.
   */
  requireSession?: boolean;
  /** Attempt renewToken after login when session runs. */
  renew?: boolean;
  /** Env prefix e.g. FANTASY402_SPEN_1_ or default FANTASY402_. */
  envPrefix?: string;
  accountId?: string;
  fetchImpl?: typeof fetch;
  WebSocketImpl?: typeof WebSocket;
  /** Pandora edge: pandora | spandora. */
  pandoraHost?: string;
  /** Injected for tests. */
  lookupFn?: typeof lookupEvent;
  sessionProbeFn?: (opts: {
    requireSession: boolean;
    renew: boolean;
    envPrefix?: string;
    accountId?: string;
  }) => Promise<EventValidateReport['session'] & { plane: PlaneResult }>;
};

function redactHost(u: string): string | null {
  try {
    return new URL(u).host;
  } catch {
    return null;
  }
}

function plane(
  status: PlaneStatus,
  code: string,
  notes: string[] = []
): PlaneResult {
  return { status, code, notes };
}

/**
 * Pure verdict from plane statuses (unit-testable).
 */
export function verdictFromPlanes(planes: EventValidateReport['planes']): {
  verdict: string;
  failedPlanes: EventValidateReport['failedPlanes'];
} {
  const failedPlanes: EventValidateReport['failedPlanes'] = [];
  if (planes.market.status === 'fail') failedPlanes.push('market');
  if (planes.profile.status === 'fail') failedPlanes.push('profile');
  if (planes.session.status === 'fail') failedPlanes.push('session');
  // inventory fail is informational only — priced_only is normal

  if (planes.market.status === 'fail') {
    if (planes.market.code === 'blocked') {
      return { verdict: 'market_blocked', failedPlanes };
    }
    return { verdict: 'market_off', failedPlanes };
  }

  if (planes.market.status === 'warn') {
    if (planes.session.status === 'fail') {
      return { verdict: 'market_warn_session_fail', failedPlanes };
    }
    if (planes.session.status === 'skip') {
      return { verdict: 'market_warn_session_skip', failedPlanes };
    }
    if (planes.session.status === 'ok') {
      return { verdict: 'market_warn_session_ok', failedPlanes };
    }
    return { verdict: 'market_warn', failedPlanes };
  }

  // market ok
  if (planes.session.status === 'fail') {
    return { verdict: 'market_ok_session_fail', failedPlanes };
  }
  if (planes.session.status === 'skip') {
    return { verdict: 'market_ok_session_skip', failedPlanes };
  }
  if (planes.session.status === 'warn') {
    return { verdict: 'market_ok_session_warn', failedPlanes };
  }
  return { verdict: 'market_ok_session_ok', failedPlanes };
}

function classifyInventory(lookup: EventLookupResult): PlaneResult {
  if (lookup.streamList.hit || lookup.skinEvents) {
    return plane('ok', 'inventory_hit', [
      lookup.streamList.hit
        ? `stream-list hit inventoryId=${lookup.streamList.event?.inventoryId ?? lookup.eventId}`
        : 'stream-list miss',
      lookup.skinEvents
        ? `skin_events hit sport=${lookup.skinEvents.sport ?? '?'}`
        : 'skin_events miss',
    ]);
  }
  if (lookup.plane === 'priced_only') {
    return plane('warn', 'priced_only', [
      'not on public stream-list — normal for Pandora event ids (inventory ≠ odds id space)',
    ]);
  }
  return plane('warn', 'inventory_miss', [
    'not on stream-list or skin_events',
  ]);
}

function classifyMarket(lookup: EventLookupResult): PlaneResult {
  const p = lookup.pandora;
  if (!p.probed) {
    return plane('skip', 'pandora_skipped', ['pandora probe skipped']);
  }

  const es = p.eventState;
  const book = p.book;
  const notes: string[] = [];

  if (es) {
    notes.push(
      `state=${es.state}(${es.stateLabel})` +
        (es.wireState != null && es.wireState !== es.state
          ? ` wire_s=${es.wireState}`
          : '') +
        ` hasLines=${es.hasLines} OTB=${es.offTheBoard}` +
        (es.sportName ? ` sport=${es.sportName}` : '') +
        (es.home || es.away
          ? ` · ${es.home ?? '?'} vs ${es.away ?? '?'}`
          : '')
    );
    if (es.blockedReason) {
      notes.push(`blocked: ${es.blockedReason}`);
      return plane('fail', 'blocked', notes);
    }
    if (es.offTheBoard) {
      notes.push(
        'off the board (finished|notBettable|blocked|!hasOdds) — do not blame session'
      );
      return plane('fail', 'otb', notes);
    }
  } else {
    notes.push('event not found under eventData board s-tree');
  }

  notes.push(`coeff lines=${p.lineCount} subscribed=${p.subscribed}`);
  if (book) {
    notes.push(
      `book offered=${book.offeredMarketCount} off=${book.offMarketCount}`
    );
  }

  if (es && es.state === PANDORA_EVENT_STATES.bettable && es.hasLines) {
    if (p.lineCount > 0 || (book && book.offeredMarketCount > 0)) {
      return plane('ok', 'bettable_with_lines', notes);
    }
    // Board says hasLines but we got no coeff snapshot in window
    notes.push(
      'board hasLines=true but 0 coeff lines in probe window — retry or watch'
    );
    return plane('warn', 'board_lines_no_coeff', notes);
  }

  if (p.lineCount > 0 && book && book.offeredMarketCount > 0) {
    return plane('ok', 'coeff_offered', notes);
  }

  if (p.lineCount > 0) {
    notes.push('lines present but book offeredMarkets=0 (empty o / rebuild)');
    return plane('warn', 'lines_empty_o', notes);
  }

  if (!es) {
    return plane('fail', 'not_on_board', notes);
  }

  notes.push('no offered coefficient markets');
  return plane('fail', 'no_lines', notes);
}

function classifyProfile(lookup: EventLookupResult): PlaneResult {
  const es = lookup.pandora.eventState;
  if (!es) {
    return plane('skip', 'no_event_state', [
      'no eventState — profile blocked unknown for this id',
    ]);
  }
  if (es.blockedReason) {
    return plane('fail', 'group_blocked', [
      es.blockedReason,
      'groupProfile.blocked forces notBettable (calculateState) — not a session fault',
    ]);
  }
  if (es.sportId) {
    return plane('ok', 'not_blocked', [
      `sport=${es.sportName ?? es.sportId} league=${es.leagueId ?? '?'} not in blocked overlay for this event`,
    ]);
  }
  return plane('ok', 'not_blocked', ['no blockedReason on event']);
}

/** Default seat probe using Fantasy402 env (no secrets in return value). */
export async function probeFantasySessionPlane(options: {
  requireSession: boolean;
  renew: boolean;
  envPrefix?: string;
  accountId?: string;
}): Promise<
  NonNullable<EventValidateReport['session']> & { plane: PlaneResult }
> {
  const prefix = options.envPrefix?.trim() || 'FANTASY402_';
  const profile = options.envPrefix
    ? loadFantasy402ProfileFromPrefix(prefix, {
        accountId: options.accountId ?? 'validate-out',
      })
    : loadFantasy402ProfileFromEnv();

  if (!profile) {
    const planeRes = options.requireSession
      ? plane('fail', 'no_creds', [
          'FANTASY402_* (or --prefix=) missing — cannot validate seat session',
        ])
      : plane('skip', 'no_creds', [
          'no FANTASY402_* in env — session plane skipped (market-only validate)',
        ]);
    return {
      attempted: false,
      required: options.requireSession,
      accountId: null,
      domain: null,
      tokenPresent: false,
      tokenLen: 0,
      loginOk: false,
      warmed: null,
      cookieCount: null,
      renewOk: null,
      placeBetUrlSet: Boolean(process.env.FANTASY402_PLACE_BET_URL?.trim()),
      liveDesktopHost: null,
      plane: planeRes,
    };
  }

  const token = profile.meta.token?.trim() ?? '';
  const notes: string[] = [
    `accountId=${profile.id}`,
    `domain=${profile.url}`,
    `tokenLen=${token.length}`,
  ];
  let loginOk = false;
  let warmed: boolean | null = null;
  let cookieCount: number | null = null;
  let renewOk: boolean | null = null;
  let liveDesktopHost: string | null = null;
  const placeBetUrlSet = Boolean(
    process.env.FANTASY402_PLACE_BET_URL?.trim()
  );

  try {
    const adapter = getFantasySessionAdapter(profile, {
      warmSession: true,
    });
    if (!(adapter instanceof FantasyUltraAdapter)) {
      throw new Error('expected FantasyUltraAdapter for session probe');
    }

    if (options.renew && 'renewToken' in adapter) {
      try {
        await adapter.renewToken();
        renewOk = true;
        notes.push('renewToken ok');
      } catch (e) {
        renewOk = false;
        notes.push(
          `renewToken fail: ${e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160)}`
        );
      }
    }

    const urls = await adapter.login();
    loginOk = true;
    liveDesktopHost = redactHost(urls.desktop);
    warmed = adapter.isWarmed();
    cookieCount = adapter.cookieCount();
    notes.push(
      `login ok host=${liveDesktopHost ?? '?'} warmed=${warmed} cookies=${cookieCount}`
    );

    if (!warmed) {
      notes.push('warmed=false — soft session hold');
    }
    if (cookieCount === 0) {
      notes.push(
        'cookie jar empty after warm — poorly held session (shell may 200 without Set-Cookie)'
      );
    }
    if (!placeBetUrlSet) {
      notes.push(
        'FANTASY402_PLACE_BET_URL unset — place-bet live POST blocked (expected without HAR map)'
      );
    }

    let status: PlaneStatus = 'ok';
    let code = 'session_ok';
    if (!warmed || cookieCount === 0) {
      status = 'warn';
      code = 'session_soft';
    }
    if (renewOk === false) {
      status = 'fail';
      code = 'renew_fail';
    }

    return {
      attempted: true,
      required: options.requireSession,
      accountId: profile.id,
      domain: profile.url,
      tokenPresent: token.length > 0,
      tokenLen: token.length,
      loginOk,
      warmed,
      cookieCount,
      renewOk,
      placeBetUrlSet,
      liveDesktopHost,
      plane: plane(status, code, notes),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
    notes.push(`login/session error: ${msg}`);
    return {
      attempted: true,
      required: options.requireSession,
      accountId: profile.id,
      domain: profile.url,
      tokenPresent: token.length > 0,
      tokenLen: token.length,
      loginOk: false,
      warmed,
      cookieCount,
      renewOk,
      placeBetUrlSet,
      liveDesktopHost,
      plane: plane('fail', 'session_error', notes),
    };
  }
}

/**
 * Validate market offerability first, then optional seat session.
 */
export async function validateEvent(
  options: EventValidateOptions
): Promise<EventValidateReport> {
  const eventId = String(options.eventId).trim();
  const periodId = options.periodId?.trim() || null;
  const requireSession = options.requireSession === true;
  const renew = options.renew === true;
  const lookupFn = options.lookupFn ?? lookupEvent;

  const lookup = await lookupFn({
    eventId,
    periodId,
    pandoraSeconds: options.pandoraSeconds ?? 10,
    fetchImpl: options.fetchImpl,
    WebSocketImpl: options.WebSocketImpl,
    pandoraHost: options.pandoraHost,
  });

  const inventory = classifyInventory(lookup);
  const market = classifyMarket(lookup);
  const profile = classifyProfile(lookup);

  const sessionProbe =
    options.sessionProbeFn ??
    ((opts: {
      requireSession: boolean;
      renew: boolean;
      envPrefix?: string;
      accountId?: string;
    }) => probeFantasySessionPlane(opts));

  const sessionRaw = await sessionProbe({
    requireSession,
    renew,
    envPrefix: options.envPrefix,
    accountId: options.accountId,
  });
  const { plane: sessionPlane, ...sessionRest } = sessionRaw;

  const planes = {
    inventory,
    market,
    profile,
    session: sessionPlane,
  };
  const { verdict, failedPlanes } = verdictFromPlanes(planes);

  return {
    eventId,
    periodId,
    pliveUrl: lookup.pliveUrl,
    planes,
    failedPlanes,
    verdict,
    lookup,
    session: sessionRest,
  };
}

export function formatEventValidate(report: EventValidateReport): string {
  const lines: string[] = [];
  lines.push(
    `event-validate id=${report.eventId}` +
      (report.periodId ? ` period=${report.periodId}` : '') +
      ` verdict=${report.verdict}`
  );
  lines.push(`  url  ${report.pliveUrl}`);
  if (report.failedPlanes.length) {
    lines.push(`  failedPlanes: ${report.failedPlanes.join(', ')}`);
  } else {
    lines.push('  failedPlanes: (none)');
  }
  lines.push('');
  lines.push('## Planes (market before session)');

  const order = ['inventory', 'market', 'profile', 'session'] as const;
  for (const name of order) {
    const p = report.planes[name];
    const mark =
      p.status === 'ok'
        ? '✓'
        : p.status === 'fail'
          ? '✗'
          : p.status === 'warn'
            ? '!'
            : '·';
    lines.push(`  ${mark} ${name.padEnd(10)} ${p.status.padEnd(4)}  ${p.code}`);
    for (const n of p.notes) {
      lines.push(`      · ${n}`);
    }
  }

  if (report.session?.attempted) {
    lines.push('');
    lines.push('## Session detail (no secrets)');
    lines.push(
      `  account=${report.session.accountId ?? '—'} domain=${report.session.domain ?? '—'}`
    );
    lines.push(
      `  tokenLen=${report.session.tokenLen} login=${report.session.loginOk} ` +
        `warmed=${report.session.warmed} cookies=${report.session.cookieCount} ` +
        `renew=${report.session.renewOk} placeUrlSet=${report.session.placeBetUrlSet}`
    );
    if (report.session.liveDesktopHost) {
      lines.push(`  liveHost=${report.session.liveDesktopHost}`);
    }
  }

  lines.push('');
  lines.push('## How to read');
  lines.push(
    '  market fail  → odds off / blocked / wrong id — fix market, not password'
  );
  lines.push(
    '  session fail → seat JWT/cookies/renew — market may still be bettable on Pandora'
  );
  lines.push(
    '  market_ok_session_skip → set FANTASY402_* or --validate-session with vault inject'
  );
  lines.push(
    '  inventory priced_only is normal (stream_id ≠ Pandora event id)'
  );
  return lines.join('\n');
}
