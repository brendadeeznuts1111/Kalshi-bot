/**
 * Seat-ops architecture SSOT (five layers).
 *
 * Partner (seat) → Communication → Accounts/Outs → Assets → Finance
 *
 * **Not** the desk matrix (`src/domain/` = skins / hosts / books / live products).
 * This module is the machine-readable map of **what exists in Kalshi-bot** vs
 * aspirational seat-capital / Telegram onboarding. Keep status honest.
 *
 * @see docs/SEAT-OPS.md
 * @see src/domain/README.md
 */

export type OpsLayerId = 'partner' | 'communication' | 'accounts' | 'assets' | 'finance';

export type OpsMaturity = 'built' | 'partial' | 'planned';

export type OpsComponent = {
  id: string;
  name: string;
  maturity: OpsMaturity;
  /** Code / table / CLI path */
  where: string;
  notes?: string;
};

export type OpsLayer = {
  id: OpsLayerId;
  name: string;
  purpose: string;
  components: OpsComponent[];
};

/** Naming conventions (do not invent alternate forms). */
export const PARTNER_NAMING = {
  partnerCode: 'UPPER short code',
  partnerCodeExample: 'SPEN',
  outId: 'out-{partnerCode}-{seq}',
  outIdExample: 'out-SPEN-1',
  bookId: 'desk brand under skin (host-derived)',
  bookIdExample: 'fantasy402',
  skinId: 'white-label family',
  skinIdExample: 'buckeye',
  vaultId: 'vault-{outId}',
  vaultIdExample: 'vault-out-SPEN-1',
  liquidityKey: '{outId}@{skin}',
  liquidityKeyExample: 'out-SPEN-1@ezlive',
  avatarFile: '{partnerCode}.svg|png',
  avatarExample: 'SPEN.png',
  envPrefix: '{BOOK}_{CODE}_{N}_ e.g. FANTASY402_SPEN_1_',
} as const;

/**
 * Canonical five-layer map for agents and `ops:status`.
 * Update maturity when shipping — never mark planned as built.
 */
export const OPS_LAYERS: readonly OpsLayer[] = [
  {
    id: 'partner',
    name: 'Partner',
    purpose: 'Financial entity that owns outs and receives split/commission.',
    components: [
      {
        id: 'partners-table',
        name: 'partners table',
        maturity: 'built',
        where: 'event-store · partners (id, name, active, profit_split, commission_rate)',
      },
      {
        id: 'partners-toml',
        name: 'partners.toml (Bun.TOML)',
        maturity: 'built',
        where: 'config/partners.example.toml · partner:toml · src/partner/toml-config.ts',
        notes: 'Non-secret SSOT on disk; seed via live_products TOML or LIVE_PRODUCTS_JSON env',
      },
      {
        id: 'partner-entity',
        name: 'PartnerEntity type',
        maturity: 'built',
        where: 'src/partner/registry.ts',
      },
      {
        id: 'partner-code',
        name: 'partnerCode on out meta',
        maturity: 'partial',
        where: 'betting_accounts.meta_json.partnerCode',
        notes: 'Set on seed (FANTASY402_PARTNER_CODE); not a dedicated partners.code column yet',
      },
      {
        id: 'partner-color-avatar',
        name: 'Deterministic color + avatar (Bun.color)',
        maturity: 'built',
        where: 'src/partner/visuals.ts · partner:profile [--png]',
        notes: 'HSL→hex/rgba/ansi-16m + SVG/PNG via Bun.Image; contrast text',
      },
      {
        id: 'glossary-partner-ops',
        name: 'Partner-ops glossary ids',
        maturity: 'built',
        where: 'src/institutions/glossary.ts · partners:validate',
      },
    ],
  },
  {
    id: 'communication',
    name: 'Communication',
    purpose: 'Partner-facing chat, alerts, bot commands, digests.',
    components: [
      {
        id: 'telegram-bot',
        name: 'Telegram long-poll bot',
        maturity: 'partial',
        where: 'src/telegram/bot.ts',
        notes: 'Calibration digest/dashboard plus permissioned /approve and /revoke_out routing',
      },
      {
        id: 'telegram-authorization-flow',
        name: 'Telegram authorization + durable receipt outbox',
        maturity: 'built',
        where: 'src/telegram/authorization-*.ts · src/partner/authorization/',
        notes:
          'Numeric chat/topic/user binding, hash-verified grants, revocation evidence, retries',
      },
      {
        id: 'telegram-subscribers',
        name: 'Subscriber list',
        maturity: 'partial',
        where: 'src/telegram/subscribers.ts · research/telegram-subscribers.json',
      },
      {
        id: 'partner-telegram-link',
        name: 'partners.telegram_chat_id / topicId',
        maturity: 'partial',
        where: 'account_authorization_requests · account_authorizations',
        notes:
          'Authorization provenance is bound; partner-level channel preferences remain planned',
      },
      {
        id: 'inventory-telegram',
        name: 'New-event Telegram notify',
        maturity: 'partial',
        where: 'tools/watch-fantasy-events.ts',
      },
      {
        id: 'execution-operations-workers',
        name: 'Independent execution workers + breaker receipts',
        maturity: 'built',
        where:
          'partner:reconcile-kalshi · partner:sync-kalshi-lifecycle · partner:deliver-receipts · partner:execution:register',
        notes:
          'Leased reconciliation and receipts plus account lifecycle ingestion run independently of Telegram polling',
      },
    ],
  },
  {
    id: 'accounts',
    name: 'Accounts / Outs',
    purpose: 'Betting accounts (outs) with multi-skin limits and book adapter.',
    components: [
      {
        id: 'betting-accounts',
        name: 'betting_accounts table',
        maturity: 'built',
        where: 'event-store · out id, provider, max_stake, meta_json',
      },
      {
        id: 'out-skin-matrix',
        name: 'Out × skin capacity',
        maturity: 'built',
        where: 'src/partner/out-capacity.ts (legacy skins.ts shim) · partner:capacity',
      },
      {
        id: 'fantasy-adapter',
        name: 'Fantasy402 Ultra adapter',
        maturity: 'partial',
        where: 'src/partner/fantasy-ultra/',
        notes: 'Login, inventory, Pandora coeffs; placeOrder live only with HAR map URL',
      },
      {
        id: 'sports-inventory',
        name: 'Sports + leagues inventory',
        maturity: 'built',
        where: 'partner:sports · 30 stream buckets · 4 primary API ids',
      },
      {
        id: 'concentration-router',
        name: 'selectAccountForProposal',
        maturity: 'partial',
        where: 'listEligibleOutCapacityPairs · concentrationByOut',
        notes: 'Helpers only — no full proposal router CLI yet',
      },
      {
        id: 'authorized-execution-wrapper',
        name: 'Transactional authorized execution wrapper',
        maturity: 'built',
        where: 'src/partner/execution/',
        notes:
          'Immediate reservation transaction, gate recheck, idempotent dispatch, ambiguous-outcome reconciliation, and durable receipts',
      },
      {
        id: 'provider-execution-bindings',
        name: 'Live provider execution bindings',
        maturity: 'built',
        where:
          'src/partner/execution/kalshi*.ts · src/bot/kalshi-client.ts · src/research/serve.ts',
        notes:
          'Kalshi V2 mapper, out-scoped client, authorized order/cancel routes, complete reconciliation evidence, provider lifecycle accounting, and demo proof tooling; production remains separately armed only after real soak review',
      },
    ],
  },
  {
    id: 'assets',
    name: 'Assets',
    purpose: 'Credentials, vault pointers, visual identity (no secrets in DB).',
    components: [
      {
        id: 'env-prefix',
        name: 'env_prefix on out',
        maturity: 'built',
        where: 'betting_accounts.env_prefix',
      },
      {
        id: 'vault-meta',
        name: 'meta.vaultId',
        maturity: 'partial',
        where: 'meta_json.vaultId on seed',
      },
      {
        id: 'proton-provision',
        name: 'Proton Pass provision',
        maturity: 'partial',
        where: 'partner:vault:provision · .env.protonpass',
        notes: 'Custom item Fantasy402; per-out vault optional',
      },
      {
        id: 'credentials-boundary',
        name: 'Secrets never in SQLite',
        maturity: 'built',
        where: 'registry seed + account-profile env/Pass only',
      },
    ],
  },
  {
    id: 'finance',
    name: 'Finance',
    purpose: 'Ledger, P&L, splits, partner reports.',
    components: [
      {
        id: 'partner-finance-cron',
        name: 'Desk finance cron (registry-driven)',
        maturity: 'built',
        where: 'partner:finance-cron · PARTNER_FINANCE_CRON=1 in cron-main',
        notes: 'Capacity + env + inventory + ticket open/settled rollup; net P&L needs list URL',
      },
      {
        id: 'partner-ledger',
        name: 'partner_ledger',
        maturity: 'partial',
        where: 'src/partner/ledger.ts · desk_snapshot · odds_book · ticket',
        notes: 'No remote settlement list API — ticket via partner:ingest-tickets (betGroups)',
      },
      {
        id: 'authorized-execution-journal',
        name: 'Immutable authorized-execution journal + projections',
        maturity: 'built',
        where: 'src/partner/execution/execution-journal.ts · provider-lifecycle-journal.ts',
        notes:
          'Integer cash, exposure, realized P&L, fees, and partner split by partner/out/skin; provider drift remains fail-closed',
      },
      {
        id: 'ledger-types',
        name: 'Generic ledger types',
        maturity: 'partial',
        where: 'src/institutions/ledger-types.ts',
        notes: 'Institution types — not partner_ledger integration',
      },
      {
        id: 'accounting-glossary',
        name: 'Accounting / event glossary',
        maturity: 'built',
        where: 'glossary accounting.* · event.partner.* · event.out.*',
      },
      {
        id: 'pnl-cron-telegram',
        name: 'Daily desk + ticket totals → Telegram',
        maturity: 'partial',
        where: 'partner:finance-cron --notify · TELEGRAM_TOPIC_ID_{CODE}',
        notes: 'Ticket risk/toWin when ingested; settled net P&L still planned',
      },
    ],
  },
] as const;

export type OpsStatusReport = {
  generatedAt: string;
  naming: typeof PARTNER_NAMING;
  layers: Array<{
    id: OpsLayerId;
    name: string;
    purpose: string;
    built: number;
    partial: number;
    planned: number;
    components: OpsComponent[];
  }>;
  totals: { built: number; partial: number; planned: number; components: number };
  orchestration: {
    ssot: string;
    clis: string[];
    missingForBotLoop: string[];
  };
};

export function buildOpsStatusReport(nowMs = Date.now()): OpsStatusReport {
  const layers = OPS_LAYERS.map(layer => {
    let built = 0;
    let partial = 0;
    let planned = 0;
    for (const c of layer.components) {
      if (c.maturity === 'built') built++;
      else if (c.maturity === 'partial') partial++;
      else planned++;
    }
    return {
      id: layer.id,
      name: layer.name,
      purpose: layer.purpose,
      built,
      partial,
      planned,
      components: [...layer.components],
    };
  });

  const totals = layers.reduce(
    (acc, l) => {
      acc.built += l.built;
      acc.partial += l.partial;
      acc.planned += l.planned;
      acc.components += l.components.length;
      return acc;
    },
    { built: 0, partial: 0, planned: 0, components: 0 }
  );

  return {
    generatedAt: new Date(nowMs).toISOString(),
    naming: PARTNER_NAMING,
    layers,
    totals,
    orchestration: {
      ssot: 'event-store SQLite (partners, betting_accounts, skin_events, account_authorizations, exposure_reservations) + Proton Pass + env',
      clis: [
        'ops:status',
        'ops:map',
        'domain:skins',
        'domain:books',
        'domain:host-discover',
        'partner:capacity',
        'partner:profile',
        'partner:toml',
        'partner:health',
        'partner:finance-cron',
        'partner:reconcile-kalshi',
        'partner:sync-kalshi-lifecycle',
        'partner:deliver-receipts',
        'partner:execution:preview/register/remove',
        'partner:execution:demo-collect',
        'partner:execution:demo-graduation',
        'partner:sports',
        'partner:registry',
        'partner:sync',
        'partner:vault:provision',
        'partner:pandora-probe',
        'partner:webview-ws-capture',
      ],
      missingForBotLoop: [
        'partners.telegram_chat_id + topic preferences',
        'Telegram /capacity /add command router',
        'authorized execution journal projection → partner report surface',
        'legacy Fantasy402 partner_ledger settlement list adapter',
      ],
    },
  };
}

export function formatOpsStatusText(report: OpsStatusReport): string {
  const lines: string[] = [];
  lines.push(
    `seat ops  built=${report.totals.built} partial=${report.totals.partial} planned=${report.totals.planned}  (${report.totals.components} components)`
  );
  for (const layer of report.layers) {
    lines.push(`\n## ${layer.name}  [${layer.built}✓ ${layer.partial}~ ${layer.planned}…]`);
    lines.push(`   ${layer.purpose}`);
    for (const c of layer.components) {
      const mark = c.maturity === 'built' ? '✓' : c.maturity === 'partial' ? '~' : '·';
      lines.push(`  ${mark} ${c.name}`);
      lines.push(`      ${c.where}`);
      if (c.notes) lines.push(`      note: ${c.notes}`);
    }
  }
  lines.push('\n## Orchestration gaps');
  for (const m of report.orchestration.missingForBotLoop) {
    lines.push(`  · ${m}`);
  }
  lines.push('\n## Naming');
  lines.push(`  out: ${PARTNER_NAMING.outIdExample}`);
  lines.push(`  vault: ${PARTNER_NAMING.vaultIdExample}`);
  lines.push(`  liquidity: ${PARTNER_NAMING.liquidityKeyExample}`);
  return lines.join('\n');
}

/**
 * Reusable architecture map for the permissioned partner execution boundary.
 * Dashed edges are expansion contracts, never claims of live provider wiring.
 */
export function formatPartnerExpansionMermaid(): string {
  return `flowchart LR
    PARTNER[Partner representative]
    TELEGRAM[Telegram group/topic]
    REQUEST[Authorization request + policy hash]
    GRANT[Active SQLite grant]
    HTTP[Authenticated compliance boundary]
    GATE[Authorization + risk + stake gate]
    KALSHI[Kalshi V2 execution]
    LIFECYCLE[Reconciliation + lifecycle]
    JOURNAL[Immutable journal]
    RECEIPT[Durable receipt outbox]
    POLYDATA[Polymarket Gamma market data]
    REGINTEL[Regulatory line-move intelligence]
    POLYEXEC["Polymarket execution adapter<br/>not implemented"]
    FANTASY["Fantasy402 execution<br/>not authorized/wired"]

    PARTNER --> TELEGRAM
    TELEGRAM --> REQUEST
    REQUEST --> GRANT
    GRANT --> GATE
    HTTP --> GATE
    GATE --> KALSHI
    KALSHI --> LIFECYCLE
    LIFECYCLE --> JOURNAL
    JOURNAL --> RECEIPT
    RECEIPT --> TELEGRAM
    POLYDATA --> REGINTEL
    REGINTEL -. intelligence only .-> HTTP
    GATE -. future provider-parity contract .-> POLYEXEC
    GATE -. blocked pending idempotency contract .-> FANTASY`;
}
