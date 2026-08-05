/**
 * Partner domain architecture SSOT (five layers).
 *
 * Partner → Communication → Accounts/Outs → Assets → Finance
 *
 * This module is the machine-readable map of **what exists in Kalshi-bot** vs
 * aspirational seat-capital / Telegram onboarding. Keep status honest.
 *
 * @see docs/PARTNER-DOMAIN.md
 */

export type DomainLayerId =
  | "partner"
  | "communication"
  | "accounts"
  | "assets"
  | "finance";

export type DomainMaturity = "built" | "partial" | "planned";

export type DomainComponent = {
  id: string;
  name: string;
  maturity: DomainMaturity;
  /** Code / table / CLI path */
  where: string;
  notes?: string;
};

export type DomainLayer = {
  id: DomainLayerId;
  name: string;
  purpose: string;
  components: DomainComponent[];
};

/** Naming conventions (do not invent alternate forms). */
export const PARTNER_NAMING = {
  partnerCode: "UPPER short code",
  partnerCodeExample: "SPEN",
  outId: "out-{partnerCode}-{seq}",
  outIdExample: "out-SPEN-1",
  vaultId: "vault-{outId}",
  vaultIdExample: "vault-out-SPEN-1",
  liquidityKey: "{outId}@{skin}",
  liquidityKeyExample: "out-SPEN-1@ezlive",
  avatarFile: "{partnerCode}.svg|png",
  avatarExample: "SPEN.png",
  envPrefix: "{BOOK}_{CODE}_{N}_ e.g. FANTASY402_SPEN_1_",
} as const;

/**
 * Canonical five-layer map for agents and `partner:domain`.
 * Update maturity when shipping — never mark planned as built.
 */
export const PARTNER_DOMAIN_LAYERS: readonly DomainLayer[] = [
  {
    id: "partner",
    name: "Partner",
    purpose: "Financial entity that owns outs and receives split/commission.",
    components: [
      {
        id: "partners-table",
        name: "partners table",
        maturity: "built",
        where: "event-store · partners (id, name, active, profit_split, commission_rate)",
      },
      {
        id: "partners-toml",
        name: "partners.toml (Bun.TOML)",
        maturity: "built",
        where: "config/partners.example.toml · partner:toml · src/partner/toml-config.ts",
        notes: "Non-secret SSOT on disk; seed registry without FANTASY402_SKINS_JSON",
      },
      {
        id: "partner-entity",
        name: "PartnerEntity type",
        maturity: "built",
        where: "src/partner/registry.ts",
      },
      {
        id: "partner-code",
        name: "partnerCode on out meta",
        maturity: "partial",
        where: "betting_accounts.meta_json.partnerCode",
        notes: "Set on seed (FANTASY402_PARTNER_CODE); not a dedicated partners.code column yet",
      },
      {
        id: "partner-color-avatar",
        name: "Deterministic color + avatar (Bun.color)",
        maturity: "built",
        where: "src/partner/visuals.ts · partner:profile [--png]",
        notes: "HSL→hex/rgba/ansi-16m + SVG/PNG via Bun.Image; contrast text",
      },
      {
        id: "glossary-partner-ops",
        name: "Partner-ops glossary ids",
        maturity: "built",
        where: "src/institutions/glossary.ts · partners:validate",
      },
    ],
  },
  {
    id: "communication",
    name: "Communication",
    purpose: "Partner-facing chat, alerts, bot commands, digests.",
    components: [
      {
        id: "telegram-bot",
        name: "Telegram long-poll bot",
        maturity: "partial",
        where: "src/telegram/bot.ts",
        notes: "Calibration digest / dashboard — not partner /capacity /add yet",
      },
      {
        id: "telegram-subscribers",
        name: "Subscriber list",
        maturity: "partial",
        where: "src/telegram/subscribers.ts · research/telegram-subscribers.json",
      },
      {
        id: "partner-telegram-link",
        name: "partners.telegram_chat_id / topicId",
        maturity: "planned",
        where: "—",
        notes: "Not on partners row; watch-fantasy-events uses global TELEGRAM_CHAT_ID",
      },
      {
        id: "inventory-telegram",
        name: "New-event Telegram notify",
        maturity: "partial",
        where: "tools/watch-fantasy-events.ts",
      },
    ],
  },
  {
    id: "accounts",
    name: "Accounts / Outs",
    purpose: "Betting accounts (outs) with multi-skin limits and book adapter.",
    components: [
      {
        id: "betting-accounts",
        name: "betting_accounts table",
        maturity: "built",
        where: "event-store · out id, provider, max_stake, meta_json",
      },
      {
        id: "out-skin-matrix",
        name: "Out × skin capacity",
        maturity: "built",
        where: "src/partner/skins.ts · partner:capacity",
      },
      {
        id: "fantasy-adapter",
        name: "Fantasy402 Ultra adapter",
        maturity: "partial",
        where: "src/partner/fantasy-ultra/",
        notes: "Login, inventory, Pandora coeffs; placeOrder live only with HAR map URL",
      },
      {
        id: "sports-inventory",
        name: "Sports + leagues inventory",
        maturity: "built",
        where: "partner:sports · 30 stream buckets · 4 primary API ids",
      },
      {
        id: "concentration-router",
        name: "selectAccountForProposal",
        maturity: "partial",
        where: "listEligibleOutSkinPairs · concentrationByOut",
        notes: "Helpers only — no full proposal router CLI yet",
      },
    ],
  },
  {
    id: "assets",
    name: "Assets",
    purpose: "Credentials, vault pointers, visual identity (no secrets in DB).",
    components: [
      {
        id: "env-prefix",
        name: "env_prefix on out",
        maturity: "built",
        where: "betting_accounts.env_prefix",
      },
      {
        id: "vault-meta",
        name: "meta.vaultId",
        maturity: "partial",
        where: "meta_json.vaultId on seed",
      },
      {
        id: "proton-provision",
        name: "Proton Pass provision",
        maturity: "partial",
        where: "partner:vault:provision · .env.protonpass",
        notes: "Custom item Fantasy402; per-out vault optional",
      },
      {
        id: "credentials-boundary",
        name: "Secrets never in SQLite",
        maturity: "built",
        where: "registry seed + account-profile env/Pass only",
      },
    ],
  },
  {
    id: "finance",
    name: "Finance",
    purpose: "Ledger, P&L, splits, partner reports.",
    components: [
      {
        id: "partner-finance-cron",
        name: "Desk finance cron (registry-driven)",
        maturity: "built",
        where: "partner:finance-cron · PARTNER_FINANCE_CRON=1 in cron-main",
        notes: "Capacity + env + inventory + ticket open/settled rollup; net P&L needs list URL",
      },
      {
        id: "partner-ledger",
        name: "partner_ledger",
        maturity: "partial",
        where: "src/partner/ledger.ts · desk_snapshot · odds_book · ticket",
        notes: "No remote settlement list API — ticket via partner:ingest-tickets (betGroups)",
      },
      {
        id: "ledger-types",
        name: "Generic ledger types",
        maturity: "partial",
        where: "src/institutions/ledger-types.ts",
        notes: "Institution types — not partner_ledger integration",
      },
      {
        id: "accounting-glossary",
        name: "Accounting / event glossary",
        maturity: "built",
        where: "glossary accounting.* · event.partner.* · event.out.*",
      },
      {
        id: "pnl-cron-telegram",
        name: "Daily desk + ticket totals → Telegram",
        maturity: "partial",
        where: "partner:finance-cron --notify · TELEGRAM_TOPIC_ID_{CODE}",
        notes: "Ticket risk/toWin when ingested; settled net P&L still planned",
      },
    ],
  },
] as const;

export type DomainStatusReport = {
  generatedAt: string;
  naming: typeof PARTNER_NAMING;
  layers: Array<{
    id: DomainLayerId;
    name: string;
    purpose: string;
    built: number;
    partial: number;
    planned: number;
    components: DomainComponent[];
  }>;
  totals: { built: number; partial: number; planned: number; components: number };
  orchestration: {
    ssot: string;
    clis: string[];
    missingForBotLoop: string[];
  };
};

export function buildDomainStatusReport(
  nowMs = Date.now(),
): DomainStatusReport {
  const layers = PARTNER_DOMAIN_LAYERS.map((layer) => {
    let built = 0;
    let partial = 0;
    let planned = 0;
    for (const c of layer.components) {
      if (c.maturity === "built") built++;
      else if (c.maturity === "partial") partial++;
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
    { built: 0, partial: 0, planned: 0, components: 0 },
  );

  return {
    generatedAt: new Date(nowMs).toISOString(),
    naming: PARTNER_NAMING,
    layers,
    totals,
    orchestration: {
      ssot: "event-store SQLite (partners, betting_accounts, partner_events) + Proton Pass + env",
      clis: [
        "partner:domain",
        "partner:capacity",
        "partner:profile",
        "partner:toml",
        "partner:health",
        "partner:finance-cron",
        "partner:sports",
        "partner:registry",
        "partner:sync",
        "partner:vault:provision",
        "partner:pandora-probe",
        "partner:webview-ws-capture",
      ],
      missingForBotLoop: [
        "partners.telegram_chat_id + topic preferences",
        "Telegram /capacity /add command router",
        "partner_ledger + split → report pipeline",
        "live placeOrder after real HAR + auto eventCoefficients subscribe",
      ],
    },
  };
}

export function formatDomainStatusText(report: DomainStatusReport): string {
  const lines: string[] = [];
  lines.push(
    `partner domain  built=${report.totals.built} partial=${report.totals.partial} planned=${report.totals.planned}  (${report.totals.components} components)`,
  );
  for (const layer of report.layers) {
    lines.push(
      `\n## ${layer.name}  [${layer.built}✓ ${layer.partial}~ ${layer.planned}…]`,
    );
    lines.push(`   ${layer.purpose}`);
    for (const c of layer.components) {
      const mark =
        c.maturity === "built" ? "✓" : c.maturity === "partial" ? "~" : "·";
      lines.push(`  ${mark} ${c.name}`);
      lines.push(`      ${c.where}`);
      if (c.notes) lines.push(`      note: ${c.notes}`);
    }
  }
  lines.push("\n## Orchestration gaps");
  for (const m of report.orchestration.missingForBotLoop) {
    lines.push(`  · ${m}`);
  }
  lines.push("\n## Naming");
  lines.push(`  out: ${PARTNER_NAMING.outIdExample}`);
  lines.push(`  vault: ${PARTNER_NAMING.vaultIdExample}`);
  lines.push(`  liquidity: ${PARTNER_NAMING.liquidityKeyExample}`);
  return lines.join("\n");
}
