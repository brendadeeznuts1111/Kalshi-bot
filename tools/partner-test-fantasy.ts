#!/usr/bin/env bun
/**
 * Live smoke for Fantasy402 Ultra adapter (dummy desk).
 *
 * Requires env (never commit secrets):
 *   FANTASY402_BEARER_TOKEN
 *   FANTASY402_CUSTOMER_ID
 *   FANTASY402_AGENT_ID
 *   FANTASY402_PASSWORD
 *
 * Usage:
 *   bun run partner:test-fantasy
 *   bun run partner:test-fantasy -- --sport=tennis --limit=8 --renew
 */
// @see https://bun.com/docs/runtime/utils#bun-env
import {
  getFantasySessionAdapter,
  requireFantasy402ProfileFromEnv,
} from "../src/partner/index.ts";

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function redactUrl(u: string): string {
  try {
    const url = new URL(u);
    const keys = [...url.searchParams.keys()];
    return `${url.origin}${url.pathname}?${keys.map((k) => `${k}=…`).join("&")}`;
  } catch {
    return "(invalid url)";
  }
}

function redactJwt(t: string): string {
  if (t.length < 20) return "(short)";
  return `${t.slice(0, 12)}…(len=${t.length})`;
}

async function main(): Promise<void> {
  const sport = argValue("sport") ?? "tennis";
  const limit = Math.min(
    Math.max(Number(argValue("limit") ?? "10") || 10, 1),
    50,
  );
  const doRenew = hasFlag("renew");

  const profile = requireFantasy402ProfileFromEnv();
  console.log(
    JSON.stringify(
      {
        accountId: profile.id,
        partner: profile.partner,
        domain: profile.url,
        customerID: profile.meta.customerID,
        agentID: profile.meta.agentID,
        skin: profile.meta.skin,
        currency: profile.meta.currency,
        tokenPresent: profile.meta.token.length > 0,
      },
      null,
      2,
    ),
  );

  const adapter = getFantasySessionAdapter(profile);

  if (doRenew) {
    const next = await adapter.renewToken();
    console.log(
      JSON.stringify({ renewed: true, bearer: redactJwt(next) }, null, 2),
    );
  }

  const urls = await adapter.login();
  if (urls && typeof urls === "object" && "desktop" in urls) {
    console.log(
      JSON.stringify(
        {
          live: {
            desktop: redactUrl(urls.desktop),
            mobile: redactUrl(urls.mobile),
          },
          warmed: "isWarmed" in adapter
            ? (adapter as { isWarmed(): boolean }).isWarmed()
            : undefined,
          cookies:
            "cookieCount" in adapter
              ? (adapter as { cookieCount(): number }).cookieCount()
              : undefined,
        },
        null,
        2,
      ),
    );
  }

  const sports = await adapter.fetchSports();
  const tennisLeagues = sports.filter((s) =>
    s.sportType.toUpperCase().includes("TENNIS"),
  );
  console.log(
    JSON.stringify(
      {
        leaguesTotal: sports.length,
        tennisLeagues: tennisLeagues.length,
        tennisSample: tennisLeagues.slice(0, 8).map((s) => ({
          type: s.sportType,
          sub: s.sportSubType,
          display: s.display,
          active: s.active,
        })),
      },
      null,
      2,
    ),
  );

  if ("inspectStreamCapabilities" in adapter) {
    const cap = await (
      adapter as {
        inspectStreamCapabilities: () => Promise<unknown>;
      }
    ).inspectStreamCapabilities();
    console.log(JSON.stringify({ streamCapabilities: cap }, null, 2));
  }

  const events = await adapter.fetchEvents({ sport });
  console.log(
    JSON.stringify(
      {
        sport,
        eventCount: events.length,
        note: "coverage rows only — not priced markets",
        sample: events.slice(0, limit).map((e) => ({
          eventId: e.eventId,
          league: e.league,
          matchup: [e.home, e.away].filter(Boolean).join(" vs "),
          streamId: e.streamId,
          feedId: e.feedId,
        })),
      },
      null,
      2,
    ),
  );

  const bookedId = argValue("booked") ?? argValue("client-event-id");
  if (bookedId && "fetchBookedEvent" in adapter) {
    const booked = await (
      adapter as {
        fetchBookedEvent: (id: string) => Promise<unknown>;
      }
    ).fetchBookedEvent(bookedId);
    console.log(JSON.stringify({ bookedEvent: booked }, null, 2));
    try {
      const odds = await (
        adapter as { fetchOdds: (id: string) => Promise<unknown> }
      ).fetchOdds(bookedId);
      console.log(JSON.stringify({ odds }, null, 2));
    } catch (err) {
      console.log(
        JSON.stringify(
          {
            fetchOdds: {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
          },
          null,
          2,
        ),
      );
    }
  } else if ("listBookedEvents" in adapter) {
    const bookedList = await (
      adapter as {
        listBookedEvents: (o: {
          sport?: string;
          limit?: number;
        }) => Promise<unknown[]>;
      }
    ).listBookedEvents({ sport, limit: Math.min(limit, 5) });
    console.log(
      JSON.stringify(
        {
          bookedSample: bookedList,
          note: "Statscore livescorepro — metadata only, not American prices",
        },
        null,
        2,
      ),
    );
  }

  if (events[0]) {
    const limits = await adapter.fetchLimits(events[0].eventId);
    console.log(JSON.stringify({ limits }, null, 2));
  }

  const dry = await adapter.placeOrder({
    eventId: events[0]?.eventId ?? "0",
    side: "home",
    stake: 10,
    dryRun: true,
  });
  console.log(JSON.stringify({ placeOrderDry: dry }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
