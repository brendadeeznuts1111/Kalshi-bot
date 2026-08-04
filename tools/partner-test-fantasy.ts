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
 *   bun run partner:test-fantasy -- --sport=tennis --limit=8
 */
// @see https://bun.com/docs/runtime/utils#bun-env
import {
  getPartnerAdapter,
  requireFantasy402ProfileFromEnv,
} from "../src/partner/index.ts";

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
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

async function main(): Promise<void> {
  const sport = argValue("sport") ?? "tennis";
  const limit = Math.min(Math.max(Number(argValue("limit") ?? "10") || 10, 1), 50);

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

  const adapter = getPartnerAdapter(profile);
  const urls = await adapter.login();
  if (urls && typeof urls === "object" && "desktop" in urls) {
    console.log(
      JSON.stringify(
        {
          live: {
            desktop: redactUrl(urls.desktop),
            mobile: redactUrl(urls.mobile),
          },
        },
        null,
        2,
      ),
    );
  }

  const events = await adapter.fetchEvents({ sport });
  console.log(
    JSON.stringify(
      {
        sport,
        eventCount: events.length,
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
