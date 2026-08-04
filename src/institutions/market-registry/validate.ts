import { IDENTITY, MARKET, SOURCE, unbrand } from "./brands.ts";
import type { SourceCapability, SourceSelector, SportsSourceRegistry } from "./types.ts";

function selectorErrors(prefix: string, selector: SourceSelector, errors: readonly string[]): string[] {
  return errors.map((error) => `${prefix}: ${error}`);
}

export function validateSportsSourceRegistry(registry: SportsSourceRegistry): string[] {
  const errors: string[] = [];
  const unique = (label: string, values: readonly string[]) => {
    const seen = new Set<string>();
    for (const value of values) {
      if (seen.has(value)) errors.push(`duplicate ${label}: ${value}`);
      seen.add(value);
    }
  };

  unique("sport", registry.sports.map((row) => unbrand(row.key)));
  unique("source", registry.sources.map((row) => unbrand(row.key)));
  unique("adapter", registry.adapters.map((row) => unbrand(row.id)));
  unique("integration", registry.integrations.map((row) => unbrand(row.integration)));
  unique(
    "sport/source cell",
    registry.integrations.map((row) => `${unbrand(row.source)}:${unbrand(row.sport)}`),
  );

  const sports = new Set(registry.sports.map((row) => unbrand(row.key)));
  const sources = new Set(registry.sources.map((row) => unbrand(row.key)));
  const adapters = new Map(registry.adapters.map((row) => [unbrand(row.id), row]));
  const scopes: string[] = [];
  const kalshiIdentityFields = new Set([
    IDENTITY.tennisCompetitor,
    IDENTITY.tennisDoublesCompetitor,
    IDENTITY.tableTennisCompetitor,
    IDENTITY.none,
  ]);

  for (const adapter of registry.adapters) {
    if (adapter.cachePolicy.freshForMs < 0 || adapter.cachePolicy.staleForMs < adapter.cachePolicy.freshForMs) {
      errors.push(`${unbrand(adapter.id)}: invalid cache freshness window`);
    }
    if (adapter.cachePolicy.failureThreshold < 1) {
      errors.push(`${unbrand(adapter.id)}: failure threshold must be positive`);
    }
    const metadata = adapter.metadataDiscovery;
    if (metadata) {
      if (!unbrand(metadata.scope).startsWith(`${unbrand(adapter.source)}:`)) {
        errors.push(`${unbrand(adapter.id)}: metadata scope source mismatch`);
      }
      if (!adapter.metadataSelectorKinds.includes(metadata.kind)) {
        errors.push(`${unbrand(adapter.id)}: unsupported metadata selector kind`);
      }
      errors.push(
        ...selectorErrors(
          `${unbrand(adapter.id)} metadata`,
          metadata,
          adapter.validateSelector(metadata),
        ),
      );
    }
  }

  for (const registration of registry.integrations) {
    const id = unbrand(registration.integration);
    const source = unbrand(registration.source);
    const sport = unbrand(registration.sport);
    if (id !== `${source}:${sport}`) errors.push(`${id}: integration id mismatch`);
    if (!sports.has(sport)) errors.push(`${id}: unknown sport`);
    if (!sources.has(source)) errors.push(`${id}: unknown source`);
    const adapter = adapters.get(unbrand(registration.adapter));
    if (!adapter) errors.push(`${id}: unknown adapter`);
    if (adapter && adapter.source !== registration.source) errors.push(`${id}: adapter source mismatch`);
    if (registration.state === "enabled" && registration.competitions.length === 0) {
      errors.push(`${id}: enabled integration has no selectors`);
    }
    if (
      registration.operationalCapabilities.includes("inventory") &&
      registration.competitions.length === 0
    ) {
      errors.push(`${id}: operational inventory has no selectors`);
    }
    if (
      registration.state === "enabled" &&
      !registration.operationalCapabilities.includes("inventory")
    ) {
      errors.push(`${id}: enabled integration lacks operational inventory`);
    }
    if (
      registration.state !== "enabled" &&
      registration.operationalCapabilities.some((capability) => capability !== "inventory")
    ) {
      errors.push(`${id}: non-enabled integration may operate inventory only`);
    }
    if (registration.state !== "enabled" && !registration.reason) {
      errors.push(`${id}: non-enabled integration requires a reason`);
    }
    if (
      (registration.state === "disabled" || registration.state === "unsupported") &&
      registration.operationalCapabilities.length > 0
    ) {
      errors.push(`${id}: inactive integration has operational capabilities`);
    }
    for (const capability of registration.operationalCapabilities) {
      if (!registration.declaredCapabilities.includes(capability)) {
        errors.push(`${id}: operational capability not declared: ${capability}`);
      }
    }
    const hasOperational = (capability: SourceCapability) =>
      registration.operationalCapabilities.includes(capability);
    if (
      hasOperational("trade") &&
      !["quotes", "reconciliation"].every((capability) =>
        hasOperational(capability as SourceCapability),
      )
    ) {
      errors.push(`${id}: operational trade requires quotes and reconciliation`);
    }
    if (
      hasOperational("reconciliation") &&
      !registration.competitions.some((binding) =>
        binding.declaredUse === "match" || binding.declaredUse === "trade"
      )
    ) {
      errors.push(`${id}: operational reconciliation has no actionable selector`);
    }
    if (
      hasOperational("trade") &&
      !registration.competitions.some((binding) => binding.declaredUse === "trade")
    ) {
      errors.push(`${id}: operational trade has no trade selector`);
    }

    for (const binding of registration.competitions) {
      const scope = unbrand(binding.selector.scope);
      scopes.push(scope);
      if (!scope.startsWith(`${source}:`)) errors.push(`${id}: selector scope source mismatch`);
      if (binding.selector.sport !== registration.sport) errors.push(`${id}: selector sport mismatch`);
      if (adapter && !adapter.selectorKinds.includes(binding.selector.kind)) {
        errors.push(`${id}: selector kind unsupported by adapter`);
      }
      if (adapter) {
        errors.push(...selectorErrors(id, binding.selector, adapter.validateSelector(binding.selector)));
      }
      if (registration.source === SOURCE.kalshi && binding.identityFields.length !== 1) {
        errors.push(`${id}: Kalshi binding must declare exactly one identity field`);
      }
      if (
        registration.source === SOURCE.kalshi &&
        binding.identityFields.includes(IDENTITY.literalOutcome)
      ) {
        errors.push(`${id}: Kalshi binding cannot use literal outcome identity`);
      }
      if (
        registration.source === SOURCE.kalshi &&
        binding.identityFields.some((field) => !kalshiIdentityFields.has(field))
      ) {
        errors.push(`${id}: unsupported Kalshi identity field`);
      }
      if (
        binding.declaredUse === "match" &&
        !registration.declaredCapabilities.includes("reconciliation")
      ) {
        errors.push(`${id}: match binding without declared reconciliation capability`);
      }
      if (
        binding.declaredUse === "trade" &&
        !["quotes", "reconciliation", "trade"].every((capability) =>
          registration.declaredCapabilities.includes(capability as SourceCapability),
        )
      ) {
        errors.push(`${id}: trade binding without declared quote/reconciliation/trade capabilities`);
      }
      if (registration.state === "enabled" && binding.declaredUse === "match" && !hasOperational("reconciliation")) {
        errors.push(`${id}: operational match binding lacks reconciliation capability`);
      }
      if (registration.state === "enabled" && binding.declaredUse === "trade" && !hasOperational("trade")) {
        errors.push(`${id}: operational trade binding lacks trade capability`);
      }
      if (
        binding.declaredUse !== "inventory" &&
        binding.identityFields.includes(IDENTITY.none)
      ) {
        errors.push(`${id}: actionable binding has no identity field`);
      }
      if (binding.marketKinds.includes(MARKET.matchWinner) && !binding.eventTypes.includes("match")) {
        errors.push(`${id}: match winner must include a match event`);
      }
      if (
        binding.marketKinds.includes(MARKET.tournamentWinner) &&
        !binding.eventTypes.includes("tournament")
      ) {
        errors.push(`${id}: tournament winner must include a tournament event`);
      }
      const sourceTypes = binding.sourceMarketMappings.map((mapping) =>
        unbrand(mapping.sourceMarketType),
      );
      unique(`${id} source market type`, sourceTypes);
      for (const mapping of binding.sourceMarketMappings) {
        if (!binding.marketKinds.includes(mapping.marketKind)) {
          errors.push(`${id}: source market mapping targets an undeclared market kind`);
        }
      }
      if (
        binding.semanticConfidence === "discovery" &&
        hasOperational("reconciliation") &&
        binding.sourceMarketMappings.length === 0
      ) {
        errors.push(`${id}: discovery reconciliation requires source market mappings`);
      }
      if (registration.source === SOURCE.kalshi && binding.semanticConfidence !== "exact") {
        errors.push(`${id}: Kalshi series selector must have exact semantics`);
      }
    }
  }
  unique("source scope", scopes);
  return errors;
}

export function assertSportsSourceRegistry(registry: SportsSourceRegistry): void {
  const errors = validateSportsSourceRegistry(registry);
  if (errors.length > 0) throw new Error(`Invalid sports/source registry:\n${errors.join("\n")}`);
}
