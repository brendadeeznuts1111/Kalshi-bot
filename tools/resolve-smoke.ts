#!/usr/bin/env bun
/**
 * Resolve smoke: COMPETITIONS self-resolve + sample inventory leagues.
 *   bun tools/resolve-smoke.ts
 */
import { listCompetitions, resolveCompetition } from '../src/domain/index.ts';
import { openEventStore } from '../src/institutions/event-store/open-db.ts';
import { DEFAULT_EVENT_STORE_DB } from '../src/institutions/event-store/paths.ts';

const comps = listCompetitions();
console.log('=== COMPETITIONS seed self-resolve (plive) ===');
console.log('seeded', comps.length);

let ok = 0;
let fail = 0;
const fails: string[] = [];
const bySport = new Map<string, { ok: number; fail: number }>();

for (const c of comps) {
  const plive = c.providerMappings.plive;
  if (!plive) {
    fail++;
    fails.push(`${c.id}: no plive mapping`);
    continue;
  }
  const r = resolveCompetition({
    liveProduct: 'plive',
    inventoryBucket: plive.inventoryBucket,
    league: plive.leagueKey,
    sportId: c.sportId,
  });
  const st = bySport.get(c.sportId) ?? { ok: 0, fail: 0 };
  if (r?.competitionId === c.id) {
    ok++;
    st.ok++;
  } else {
    fail++;
    st.fail++;
    fails.push(
      `${c.id}: got ${r?.competitionId ?? 'UNRESOLVED'} for bucket=${plive.inventoryBucket} league=${JSON.stringify(plive.leagueKey)}`
    );
  }
  bySport.set(c.sportId, st);
}

console.log(`self-resolve ok=${ok} fail=${fail}`);
for (const [sp, s] of [...bySport.entries()].sort((a, b) => b[1].ok - a[1].ok)) {
  console.log(`  ${sp.padEnd(20)} ok=${s.ok} fail=${s.fail}`);
}
if (fails.length) {
  console.log('\nfailures (first 30):');
  for (const f of fails.slice(0, 30)) console.log('  ', f);
}

console.log('\n=== ezlive shell fallback samples ===');
const samples = [
  { sportId: 'soccer', league: 'Argentina Liga Profesional' },
  { sportId: 'baseball', league: 'MLB' },
  { sportId: 'baseball', league: 'Mexico LMB' },
  { sportId: 'basketball', league: 'Australia NBL' },
  { sportId: 'table_tennis', league: 'Setka Cup' },
  { sportId: 'table_tennis', league: 'International. Setka Cup. Men' },
  {
    sportId: 'tennis',
    league: 'Argentina ITF Cordoba [ ARG] |  Men | Singles',
  },
  { sportId: 'ice_hockey', league: 'Finland Liiga' },
  { sportId: 'cricket', league: 'England The Hundred' },
];
for (const s of samples) {
  const plive = resolveCompetition({
    liveProduct: 'plive',
    sportId: s.sportId,
    league: s.league,
  });
  const ez = resolveCompetition({
    liveProduct: 'ezlive',
    sportId: s.sportId,
    league: s.league,
  });
  console.log(
    `${s.sportId.padEnd(14)} ${s.league.slice(0, 44).padEnd(44)} plive=${(plive?.competitionId ?? '—').padEnd(40)} ez=${ez?.competitionId ?? '—'}`
  );
}

console.log('\n=== inventory skin_events league resolve ===');
try {
  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
  const rows = db
    .query(
      `SELECT sport, league, COUNT(*) AS n
       FROM skin_events
       WHERE league IS NOT NULL AND TRIM(league) != ''
       GROUP BY sport, league
       ORDER BY n DESC
       LIMIT 100`
    )
    .all() as Array<{ sport: string; league: string; n: number }>;

  let invOk = 0;
  let invFail = 0;
  const invFails: string[] = [];
  for (const row of rows) {
    const r = resolveCompetition({
      liveProduct: 'plive',
      sportId: row.sport,
      league: row.league,
    });
    if (r) invOk++;
    else {
      invFail++;
      if (invFails.length < 25) {
        invFails.push(`${row.sport} | ${row.league} (n=${row.n})`);
      }
    }
  }
  console.log(
    `top-${rows.length} distinct leagues: resolve_ok=${invOk} unresolved=${invFail}`
  );
  if (invFails.length) {
    console.log('unresolved (sample):');
    for (const f of invFails) console.log('  ', f);
  }

  const fill = db
    .query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN competition_id IS NOT NULL AND TRIM(competition_id) != '' THEN 1 ELSE 0 END) AS with_comp
       FROM skin_events`
    )
    .get() as { total: number; with_comp: number };
  console.log(
    `skin_events.competition_id stamped: ${fill.with_comp}/${fill.total} (${fill.total ? Math.round((100 * fill.with_comp) / fill.total) : 0}%)`
  );
  console.log('(stamped % rises after: bun run inventory:leagues -- --backfill)');
} catch (e) {
  console.log('inventory DB skip:', e instanceof Error ? e.message : e);
}

const pids = new Map<string, string[]>();
for (const c of comps) {
  const id = (
    c as { providerMappings?: { pandora?: { leagueId?: string } } }
  ).providerMappings?.pandora?.leagueId;
  if (!id) continue;
  const arr = pids.get(id) ?? [];
  arr.push(c.id);
  pids.set(id, arr);
}
const dups = [...pids.entries()].filter(([, v]) => v.length > 1);
console.log('\n=== pandora.leagueId ===');
console.log(
  `with pandora id: ${pids.size} · duplicate feed ids: ${dups.length}`
);
if (dups.length) {
  for (const [id, cs] of dups.slice(0, 10)) {
    console.log(`  ${id} → ${cs.join(', ')}`);
  }
}

process.exit(fail > 0 ? 1 : 0);
