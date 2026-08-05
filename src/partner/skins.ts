/**
 * PPH out × skin liquidity matrix.
 *
 * Out = account (credentials + working balance).
 * Skin = live interface / provider surface (ezlive, dark, "2", plive, …)
 *   with its own perBetMax / maxWin — same vault credentials, different login skin.
 *
 * Internal liquidity key: `{outId}@{skin}` (e.g. out-SPEN-1@ezlive).
 * Concentration groups by outId across skins — never per-skin in isolation.
 *
 * Vault stores credentials once per out; skin lives in seat-capital / meta only.
 */

/** Provider skin name as sent on getUltraLiveURL / widget (string or numeric wire). */
export type SkinName = string;

/** One active interface under an out. */
export type OutSkinLimit = {
  name: SkinName;
  perBetMax: number;
  maxWin: number;
  active: boolean;
};

/** Non-secret meta on betting_accounts.meta_json (seat-capital shape). */
export type OutMeta = {
  vaultId?: string;
  partnerCode?: string;
  /** Shared account balance across skins (out-level). */
  workingBalance?: number;
  /** Default skin when no skins[] or adapter override. */
  defaultSkin?: SkinName;
  /** Per-skin limits — capacity matrix rows. */
  skins?: Array<{
    name?: string;
    skin?: string;
    perBetMax?: number;
    maxStake?: number;
    maxWin?: number;
    active?: boolean;
  }>;
  /** Opaque non-secret labels only — never password / token. */
  customerID?: string;
  agentID?: string;
  office?: string;
  [key: string]: unknown;
};

/** Expanded out for capacity / routing. */
export type OutCapacity = {
  outId: string;
  partnerId: string;
  provider: string;
  workingBalance: number | null;
  skins: OutSkinLimit[];
  /** Sum of active skins' perBetMax (true out stake ceiling if split). */
  totalPerBetMax: number;
  totalMaxWin: number;
};

/** Eligible execution route: out + skin that can take `stake`. */
export type OutSkinPair = {
  outId: string;
  partnerId: string;
  provider: string;
  skin: SkinName;
  perBetMax: number;
  maxWin: number;
  workingBalance: number | null;
  /** Internal tracking key */
  key: string;
};

export type OutExposureShare = {
  outId: string;
  exposure: number;
  share: number;
};

/** `out-SPEN-1@ezlive` */
export function liquidityKey(outId: string, skin: SkinName): string {
  return `${outId}@${skin}`;
}

export function parseLiquidityKey(
  key: string,
): { outId: string; skin: SkinName } | null {
  const at = key.lastIndexOf("@");
  if (at <= 0 || at === key.length - 1) return null;
  return { outId: key.slice(0, at), skin: key.slice(at + 1) };
}

/** Naming: out-{PARTNER}-{n} */
export function formatOutId(partnerCode: string, number: number | string): string {
  const code = partnerCode.trim().toUpperCase().replace(/^OUT-/, "");
  return `out-${code}-${number}`;
}

export function formatVaultName(outId: string): string {
  return `vault-${outId}`;
}

/**
 * Parse skin for Ultra login body.
 * Numeric strings ("2") stay numbers (legacy Fantasy skin id);
 * named skins ("ezlive", "dark") stay strings.
 */
export function parseSkinWire(raw: string | number | null | undefined, fallback: string | number = 2): string | number {
  if (raw == null || raw === "") return fallback;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const s = String(raw).trim();
  if (!s) return fallback;
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return s;
}

export function parseOutMeta(metaJson: string | null | undefined): OutMeta {
  if (!metaJson?.trim()) return {};
  try {
    const v = JSON.parse(metaJson) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as OutMeta;
  } catch {
    /* ignore */
  }
  return {};
}

/**
 * Resolve active skins for an account.
 * Prefer meta.skins[]; else synthesize one skin from column skin + maxStake/maxWin.
 */
export function resolveOutSkins(input: {
  id: string;
  maxStake: number;
  maxWin: number;
  skin: number | null;
  metaJson: string;
  status?: string;
}): OutSkinLimit[] {
  if (input.status && input.status !== "active") return [];

  const meta = parseOutMeta(input.metaJson);
  const fromMeta = (meta.skins ?? [])
    .map((row): OutSkinLimit | null => {
      const name = String(row.name ?? row.skin ?? "").trim();
      if (!name) return null;
      const perBetMax = Number(row.perBetMax ?? row.maxStake ?? 0) || 0;
      const maxWin = Number(row.maxWin ?? 0) || 0;
      const active = row.active !== false;
      return { name, perBetMax, maxWin, active };
    })
    .filter((s): s is OutSkinLimit => s != null);

  if (fromMeta.length > 0) {
    return fromMeta.filter((s) => s.active);
  }

  const defaultName =
    meta.defaultSkin?.trim() ||
    (input.skin != null && Number.isFinite(input.skin)
      ? String(input.skin)
      : "2");
  return [
    {
      name: defaultName,
      perBetMax: Number(input.maxStake) || 0,
      maxWin: Number(input.maxWin) || 0,
      active: true,
    },
  ];
}

export function outCapacityFromAccount(input: {
  id: string;
  partnerId: string;
  provider: string;
  maxStake: number;
  maxWin: number;
  skin: number | null;
  metaJson: string;
  status?: string;
}): OutCapacity {
  const skins = resolveOutSkins(input);
  const meta = parseOutMeta(input.metaJson);
  const workingBalance =
    typeof meta.workingBalance === "number" && Number.isFinite(meta.workingBalance)
      ? meta.workingBalance
      : null;
  return {
    outId: input.id,
    partnerId: input.partnerId,
    provider: input.provider,
    workingBalance,
    skins,
    totalPerBetMax: skins.reduce((s, x) => s + x.perBetMax, 0),
    totalMaxWin: skins.reduce((s, x) => s + x.maxWin, 0),
  };
}

/**
 * Eligible (out, skin) pairs that can accept `stake`.
 * workingBalance (if set) must also cover stake at out level.
 */
export function listEligibleOutSkinPairs(
  accounts: Array<{
    id: string;
    partnerId: string;
    provider: string;
    maxStake: number;
    maxWin: number;
    skin: number | null;
    metaJson: string;
    status?: string;
  }>,
  stake: number,
  options?: { provider?: string },
): OutSkinPair[] {
  const pairs: OutSkinPair[] = [];
  for (const a of accounts) {
    if (a.status && a.status !== "active") continue;
    if (options?.provider && a.provider !== options.provider) continue;
    const out = outCapacityFromAccount(a);
    if (
      out.workingBalance != null &&
      out.workingBalance < stake
    ) {
      continue;
    }
    for (const sk of out.skins) {
      if (sk.perBetMax < stake) continue;
      pairs.push({
        outId: out.outId,
        partnerId: out.partnerId,
        provider: out.provider,
        skin: sk.name,
        perBetMax: sk.perBetMax,
        maxWin: sk.maxWin,
        workingBalance: out.workingBalance,
        key: liquidityKey(out.outId, sk.name),
      });
    }
  }
  return pairs.sort((a, b) => b.perBetMax - a.perBetMax || a.key.localeCompare(b.key));
}

/**
 * After concentration picks an out, choose skin within that out.
 * Default: highest perBetMax that covers stake.
 */
export function pickBestSkinForOut(
  skins: OutSkinLimit[],
  stake: number,
  prefer: "maxCapacity" | "first" = "maxCapacity",
): OutSkinLimit | null {
  const ok = skins.filter((s) => s.active && s.perBetMax >= stake);
  if (ok.length === 0) return null;
  if (prefer === "first") return ok[0] ?? null;
  return [...ok].sort((a, b) => b.perBetMax - a.perBetMax || a.name.localeCompare(b.name))[0] ?? null;
}

/**
 * Concentration by out (sum exposure across skins of the same out).
 * Share = exposure / total (or sum of exposures if total omitted).
 */
export function concentrationByOut(
  legs: Array<{ outId: string; amount: number }>,
  totalBook?: number,
): OutExposureShare[] {
  const by = new Map<string, number>();
  for (const leg of legs) {
    by.set(leg.outId, (by.get(leg.outId) ?? 0) + Math.max(0, leg.amount));
  }
  const sum = [...by.values()].reduce((a, b) => a + b, 0);
  const denom = totalBook != null && totalBook > 0 ? totalBook : sum || 1;
  return [...by.entries()]
    .map(([outId, exposure]) => ({
      outId,
      exposure,
      share: exposure / denom,
    }))
    .sort((a, b) => b.share - a.share || a.outId.localeCompare(b.outId));
}

/** Build meta_json skins array (no secrets). */
export function buildSkinsMeta(input: {
  skins: OutSkinLimit[];
  workingBalance?: number;
  vaultId?: string;
  partnerCode?: string;
  customerID?: string;
  agentID?: string;
  defaultSkin?: SkinName;
  extra?: Record<string, unknown>;
}): string {
  const meta: OutMeta = {
    ...(input.extra ?? {}),
    skins: input.skins.map((s) => ({
      name: s.name,
      perBetMax: s.perBetMax,
      maxWin: s.maxWin,
      active: s.active,
    })),
  };
  if (input.workingBalance != null) meta.workingBalance = input.workingBalance;
  if (input.vaultId) meta.vaultId = input.vaultId;
  if (input.partnerCode) meta.partnerCode = input.partnerCode;
  if (input.customerID) meta.customerID = input.customerID;
  if (input.agentID) meta.agentID = input.agentID;
  if (input.defaultSkin) meta.defaultSkin = input.defaultSkin;
  return JSON.stringify(meta);
}
