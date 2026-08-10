// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  defaultUrlForSkin,
  RETIRED_BARE_BOOK_DOMAIN_ENVS,
  urlForHost,
} from '../../src/domain/index.ts';
import { openEventStore } from '../../src/institutions/event-store/open-db.ts';
import { computeProviderCapacity, listActiveBettingAccounts } from '../../src/partner/registry.ts';
import {
  DESK_DOMAIN_ENV,
  canonicalOutEnvPrefix,
  canonicalPartnerEnvPrefix,
  checkPartnersEnvPresence,
  diffPartnersTomlVsDb,
  materializePartnersToml,
  parsePartnersToml,
  resolvePartnerEnv,
  seedRegistryFromPartnersToml,
  stringifyPartnersToml,
  validatePartnerAssetPrefixes,
} from '../../src/partner/toml-config.ts';

const SAMPLE = `
version = 1
title = "test partners"

[[partners]]
code = "SPEN"
id = "partner-spen"
name = "Partner SPEN"
active = true
profit_split = 0.5

[[outs]]
id = "out-SPEN-1"
partner_code = "SPEN"
provider = "fantasy402"
env_prefix = "FANTASY402_"
currency = "USD"
working_balance = 5000
vault_id = "vault-out-SPEN-1"
live_products = [
  { name = "ezlive", per_bet_max = 500, max_win = 2500, active = true },
  { name = "dark", per_bet_max = 1000, max_win = 5000, active = true },
]
`;

describe('partners TOML (Bun.TOML)', () => {
  test('parse + materialize multi-skin out', () => {
    const doc = parsePartnersToml(SAMPLE);
    expect(doc.version).toBe(1);
    expect(doc.partners?.[0]?.code).toBe('SPEN');
    const { partners, accounts } = materializePartnersToml(doc);
    expect(partners).toHaveLength(1);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.id).toBe('out-SPEN-1');
    expect(accounts[0]?.maxStake).toBe(1000); // max of live products
    expect(accounts[0]?.envPrefix).toBe('FANTASY402_SPEN_1_'); // bare → per-out
    expect(accounts[0]?.skin).toBeNull();
    expect(accounts[0]?.metaJson).toContain('ezlive');
    expect(accounts[0]?.metaJson).toContain('vault-out-SPEN-1');
    expect(accounts[0]?.metaJson).not.toContain('password');
    // Ultra default url → fantasy402 book + buckeye skin stamped at materialize
    expect(accounts[0]?.skinId).toBe('buckeye');
    expect(String(accounts[0]?.bookId)).toBe('fantasy402');
    expect(accounts[0]?.metaJson).toContain('"skinId":"buckeye"');
    expect(accounts[0]?.metaJson).toContain('"bookId":"fantasy402"');
    expect(accounts[0]?.metaJson).toContain('"liveProducts"');
    expect(accounts[0]?.metaJson).not.toContain('"skins"');
  });


  test('legacy skins = still dual-read on parse', () => {
    const doc = parsePartnersToml(`
[[partners]]
code = "SPEN"
id = "partner-spen"
name = "Partner SPEN"
[[outs]]
id = "out-SPEN-1"
partner_code = "SPEN"
provider = "fantasy402"
url = "https://fantasy402.com"
skins = [{ name = "ezlive", per_bet_max = 500, max_win = 2500, active = true }]
`);
    const m = materializePartnersToml(doc);
    expect(m.accounts[0]?.maxStake).toBe(500);
    expect(m.accounts[0]?.skin).toBeNull();
  });

  test('materialize stamps bookId from url; matching book_id ok; conflict throws', () => {
    const withUrl = parsePartnersToml(`
[[partners]]
code = "SPEN"
id = "partner-spen"
name = "Partner SPEN"
[[outs]]
id = "out-SPEN-1"
partner_code = "SPEN"
provider = "fantasy402"
url = "https://fantasy402.com"
book_id = "fantasy402"
live_products = [{ name = "ezlive", per_bet_max = 500, max_win = 2500, active = true }]
`);
    const ok = materializePartnersToml(withUrl);
    expect(String(ok.accounts[0]?.bookId)).toBe('fantasy402');
    expect(ok.accounts[0]?.skinId).toBe('buckeye');

    const conflict = parsePartnersToml(`
[[partners]]
code = "SPEN"
id = "partner-spen"
name = "Partner SPEN"
[[outs]]
id = "out-SPEN-1"
partner_code = "SPEN"
provider = "fantasy402"
url = "https://fantasy402.com"
book_id = "parlay21"
live_products = [{ name = "ezlive", per_bet_max = 500, max_win = 2500, active = true }]
`);
    expect(() => materializePartnersToml(conflict)).toThrow(/conflicts with url host book/);
  });

  test('canonicalOutEnvPrefix + validatePartnerAssetPrefixes', () => {
    expect(canonicalPartnerEnvPrefix('fantasy402', 'SPEN')).toBe('FANTASY402_SPEN_');
    expect(canonicalOutEnvPrefix('fantasy402', 'out-SPEN-3', 'SPEN')).toBe('FANTASY402_SPEN_3_');
    expect(canonicalOutEnvPrefix('betusa', 'out-SPEN-3', 'SPEN')).toBe('BETUSA_SPEN_3_');
    const ok = validatePartnerAssetPrefixes(parsePartnersToml(SAMPLE));
    expect(ok).toHaveLength(0);

    const bad = parsePartnersToml(`
[[partners]]
code = "SPEN"
id = "partner-spen"
name = "X"
[[outs]]
id = "wrong-id"
partner_code = "SPEN"
provider = "fantasy402"
env_prefix = "OTHER_"
vault_id = "vault-nope"
live_products = [{ name = "2", per_bet_max = 1, max_win = 1 }]
`);
    const issues = validatePartnerAssetPrefixes(bad);
    expect(issues.some(i => i.field === 'env_prefix')).toBe(true);
    expect(issues.some(i => i.field === 'out_id')).toBe(true);
    expect(issues.some(i => i.field === 'vault_id')).toBe(true);
  });

  test('round-trip stringify → parse', () => {
    const doc = parsePartnersToml(SAMPLE);
    const text = stringifyPartnersToml(doc);
    expect(text).toContain('out-SPEN-1');
    const again = parsePartnersToml(text);
    expect(again.outs?.[0]?.id).toBe('out-SPEN-1');
  });

  test('invalid TOML throws', () => {
    expect(() => parsePartnersToml('invalid = = =')).toThrow();
  });

  test('seed registry capacity sums skins', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const doc = parsePartnersToml(SAMPLE);
    const n = seedRegistryFromPartnersToml(db, doc);
    expect(n.partners).toBe(1);
    expect(n.accounts).toBe(1);
    const accounts = listActiveBettingAccounts(db);
    const cap = computeProviderCapacity(accounts);
    const f = cap.find(c => c.provider === 'fantasy402');
    expect(f?.totalMaxStake).toBe(1500); // 500+1000
    expect(f?.capacityPairCount).toBe(2);
  });

  test('example file on disk parses', async () => {
    const text = await Bun.file('config/partners.example.toml').text();
    const doc = parsePartnersToml(text);
    expect((doc.partners ?? []).length).toBeGreaterThanOrEqual(2);
    expect((doc.outs ?? []).length).toBeGreaterThanOrEqual(2);
    const { accounts } = materializePartnersToml(doc);
    expect(accounts.some(a => a.id === 'out-SPEN-1')).toBe(true);
  });

  test('seed is idempotent (upsert, no duplicate rows)', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const doc = parsePartnersToml(SAMPLE);
    seedRegistryFromPartnersToml(db, doc);
    seedRegistryFromPartnersToml(db, doc);
    const nPartners = (db.query(`SELECT COUNT(*) AS c FROM partners`).get() as { c: number }).c;
    const nOuts = (
      db.query(`SELECT COUNT(*) AS c FROM betting_accounts`).get() as {
        c: number;
      }
    ).c;
    expect(nPartners).toBe(1);
    expect(nOuts).toBe(1);
  });

  test('zod rejects bad skin numbers', () => {
    const bad = `
[[outs]]
id = "x"
live_products = [{ name = "ezlive", per_bet_max = "not-a-number" }]
`;
    // coerce.number may still fail on pure garbage
    expect(() => parsePartnersToml(bad)).toThrow();
  });

  test('resolvePartnerEnv: out → partner → book fallback', () => {
    const env = {
      FANTASY402_ASH_1_CUSTOMER_ID: 'ASH1-out',
      FANTASY402_ASH_BEARER_TOKEN: 'ash-partner-jwt',
      FANTASY402_BEARER_TOKEN: 'global-jwt',
      FANTASY402_CUSTOMER_ID: 'GLOBAL',
      FANTASY402_PASSWORD: 'gp',
    };
    const ash = resolvePartnerEnv('FANTASY402_ASH_1_', env, undefined, {
      provider: 'fantasy402',
    });
    expect(ash.values.CUSTOMER_ID).toBe('ASH1-out');
    expect(ash.source.CUSTOMER_ID).toBe('out');
    expect(ash.values.BEARER_TOKEN).toBe('ash-partner-jwt');
    expect(ash.source.BEARER_TOKEN).toBe('partner');
    expect(ash.values.PASSWORD).toBe('gp');
    expect(ash.source.PASSWORD).toBe('book_fallback');

    const base = resolvePartnerEnv('FANTASY402_', env);
    expect(base.values.CUSTOMER_ID).toBe('GLOBAL');
    expect(base.source.CUSTOMER_ID).toBe('out');
  });

  test('resolvePartnerEnv: retired bare-book DOMAIN ignored; DESK_DOMAIN / per-out DOMAIN win', () => {
    const retired = Object.fromEntries(
      RETIRED_BARE_BOOK_DOMAIN_ENVS.map(k => [k, 'https://evil.example'])
    );
    const ignored = {
      FANTASY402_BEARER_TOKEN: 't',
      FANTASY402_CUSTOMER_ID: 'c',
      FANTASY402_AGENT_ID: 'a',
      FANTASY402_PASSWORD: 'p',
      ...retired,
    };
    const bare = resolvePartnerEnv('FANTASY402_', ignored);
    expect(bare.values.DOMAIN).toBeUndefined();

    const aceDesk = defaultUrlForSkin('ace')!;
    const lonestarDesk = urlForHost('lonestarwagering.com');
    const withLegacyDomain = resolvePartnerEnv('FANTASY402_', {
      ...ignored,
      [DESK_DOMAIN_ENV]: aceDesk,
    });
    expect(withLegacyDomain.values.DOMAIN).toBe(aceDesk);
    expect(withLegacyDomain.source.DOMAIN).toBe('book_fallback');

    const withDeskDomain = resolvePartnerEnv('FANTASY402_', {
      ...ignored,
      [DESK_DOMAIN_ENV]: aceDesk,
    });
    expect(withDeskDomain.values.DOMAIN).toBe(aceDesk);
    expect(withDeskDomain.source.DOMAIN).toBe('book_fallback');

    const perOut = resolvePartnerEnv('FANTASY402_SPEN_1_', {
      ...ignored,
      FANTASY402_SPEN_1_DOMAIN: lonestarDesk,
      [DESK_DOMAIN_ENV]: aceDesk,
    });
    expect(perOut.values.DOMAIN).toBe(lonestarDesk);
    expect(perOut.source.DOMAIN).toBe('out');
  });

  test('diff: empty db → all adds; after seed → no changes; edit → change', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const doc = parsePartnersToml(SAMPLE);
    const d1 = diffPartnersTomlVsDb(doc, db);
    expect(d1.added).toBe(2); // partner + out
    expect(d1.changed).toBe(0);

    seedRegistryFromPartnersToml(db, doc);
    const d2 = diffPartnersTomlVsDb(doc, db);
    expect(d2.added).toBe(0);
    expect(d2.changed).toBe(0);
    expect(d2.removed).toBe(0);

    const edited = parsePartnersToml(SAMPLE.replace('Partner SPEN', 'Partner SPEN X'));
    const d3 = diffPartnersTomlVsDb(edited, db);
    expect(d3.changed).toBeGreaterThanOrEqual(1);
    expect(d3.entries.some(e => e.kind === 'change' && e.entity === 'partner')).toBe(true);
  });

  test('checkPartnersEnvPresence reports missing without leaking values', () => {
    const { accounts } = materializePartnersToml(parsePartnersToml(SAMPLE));
    const report = checkPartnersEnvPresence(accounts, {
      envMap: { FANTASY402_CUSTOMER_ID: 'only-customer' },
    });
    expect(report.ok).toBe(false);
    expect(report.outs[0]?.missing).toContain('BEARER_TOKEN');
    expect(report.outs[0]?.present).toContain('CUSTOMER_ID');
    const blob = JSON.stringify(report);
    expect(blob).not.toContain('only-customer');
  });
});
