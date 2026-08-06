import {
  asMetadataReasonCode,
  unbrand,
  type SourceScopeId,
} from "./brands.ts";
import { SPORTS_SOURCE_REGISTRY } from "./registry.ts";
import type {
  CompetitionBinding,
  MetadataClassificationPolicy,
  NormalizedSourceMetadata,
  SourceMetadataClassificationDecision,
  SportSourceRegistration,
  SportsSourceRegistry,
} from "./types.ts";
import { assertSportsSourceRegistry } from "./validate.ts";

type ClassificationContext = {
  registration: SportSourceRegistration;
  policy: MetadataClassificationPolicy;
  facetScopes: SourceScopeId[];
  identityScopes: SourceScopeId[];
  exactScopes: SourceScopeId[];
  requiredAttributesMatch: boolean;
};

const REASON = {
  exactRegistryMatch: asMetadataReasonCode("exact_registry_match"),
  coveredByRegisteredFacet: asMetadataReasonCode("covered_by_registered_facet"),
  unregisteredCandidate: asMetadataReasonCode("unregistered_candidate"),
  registeredMetadataDrift: asMetadataReasonCode("registered_metadata_drift"),
  candidateMetadataDrift: asMetadataReasonCode("candidate_metadata_drift"),
  ambiguousSport: asMetadataReasonCode("ambiguous_sport"),
} as const;

/**
 * Interpret provider metadata through explicit registry policy. This function
 * never mutates or extends the curated registry: discovery can only explain,
 * quarantine, or ignore source truth.
 */
export function classifySourceMetadata(
  entity: NormalizedSourceMetadata,
  registry: SportsSourceRegistry = SPORTS_SOURCE_REGISTRY,
): SourceMetadataClassificationDecision[] {
  assertSportsSourceRegistry(registry);
  assertMetadataEntity(entity, registry);
  const contexts = registry.integrations.flatMap((registration) => {
    if (registration.source !== entity.source || !registration.metadataPolicy) return [];
    if (registration.metadataPolicy.entityKind !== entity.metadataKind) return [];
    return [classificationContext(entity, registration, registration.metadataPolicy)];
  });
  if (contexts.length === 0) {
    throw new Error(
      `metadata kind is not configured for source: ${unbrand(entity.metadataKind)}`,
    );
  }
  const identityOwners = contexts.filter(
    (context) =>
      context.policy.registrationMatch.kind === "metadata_id" &&
      context.identityScopes.length > 0,
  );
  const uniqueIdentityOwner = identityOwners.length === 1 ? identityOwners[0] : undefined;
  const facetSports = new Set(
    contexts
      .filter((context) => context.facetScopes.length > 0)
      .map((context) => unbrand(context.registration.sport)),
  );
  const identityConflict =
    uniqueIdentityOwner !== undefined &&
    contexts.some(
      (context) => context !== uniqueIdentityOwner && context.facetScopes.length > 0,
    );
  const ambiguousSports =
    identityOwners.length > 1 || (!uniqueIdentityOwner && facetSports.size > 1);

  return contexts.map((context) =>
    classifyContext(entity, context, ambiguousSports, uniqueIdentityOwner, identityConflict),
  );
}

function classificationContext(
  entity: NormalizedSourceMetadata,
  registration: SportSourceRegistration,
  policy: MetadataClassificationPolicy,
): ClassificationContext {
  if (!Object.prototype.hasOwnProperty.call(entity.facets, policy.candidateFacet)) {
    throw new Error(`metadata candidate facet missing: ${policy.candidateFacet}`);
  }
  const facetValues = new Set(entity.facets[policy.candidateFacet]!);
  const requiredAttributesMatch = Object.entries(policy.requiredAttributes).every(
    ([key, value]) => entity.attributes[key] === value,
  );
  const facetScopes = matchingScopes(registration.competitions, (binding) => {
    const candidate = binding.selector.parameters[policy.candidateSelectorParameter];
    return candidate !== undefined && facetValues.has(candidate);
  });
  const registrationMatch = policy.registrationMatch;
  const identityScopes =
    registrationMatch.kind === "metadata_id"
      ? matchingScopes(registration.competitions, (binding) =>
          binding.selector.parameters[registrationMatch.selectorParameter] ===
          unbrand(entity.metadataId),
        )
      : facetScopes;
  const exactScopes = requiredAttributesMatch
    ? identityScopes.filter((scope) => facetScopes.includes(scope))
    : [];
  return {
    registration,
    policy,
    facetScopes,
    identityScopes,
    exactScopes,
    requiredAttributesMatch,
  };
}

function classifyContext(
  entity: NormalizedSourceMetadata,
  context: ClassificationContext,
  ambiguousSports: boolean,
  uniqueIdentityOwner: ClassificationContext | undefined,
  identityConflict: boolean,
): SourceMetadataClassificationDecision {
  const base = {
    source: entity.source,
    sport: context.registration.sport,
    metadataId: entity.metadataId,
  };
  const involved = context.facetScopes.length > 0 || context.identityScopes.length > 0;
  if (
    uniqueIdentityOwner &&
    identityConflict &&
    (context === uniqueIdentityOwner || context.facetScopes.length > 0)
  ) {
    return { ...base, disposition: "quarantined", reasonCode: REASON.registeredMetadataDrift };
  }
  if (ambiguousSports && involved) {
    return { ...base, disposition: "quarantined", reasonCode: REASON.ambiguousSport };
  }
  if (context.policy.registrationMatch.kind === "metadata_id") {
    if (context.exactScopes.length === 1 && context.identityScopes.length === 1) {
      return {
        ...base,
        disposition: "registered",
        reasonCode: REASON.exactRegistryMatch,
        matchedSelectorScope: context.exactScopes[0]!,
      };
    }
    if (context.identityScopes.length > 0) {
      return {
        ...base,
        disposition: "quarantined",
        reasonCode:
          context.identityScopes.length > 1
            ? REASON.ambiguousSport
            : REASON.registeredMetadataDrift,
      };
    }
    if (context.facetScopes.length > 0) {
      return {
        ...base,
        disposition: "quarantined",
        reasonCode: REASON.unregisteredCandidate,
      };
    }
  } else if (context.requiredAttributesMatch && context.facetScopes.length === 1) {
    return {
      ...base,
      disposition: "registered",
      reasonCode: REASON.coveredByRegisteredFacet,
      matchedSelectorScope: context.facetScopes[0]!,
    };
  } else if (context.facetScopes.length > 1) {
    return { ...base, disposition: "quarantined", reasonCode: REASON.ambiguousSport };
  } else if (context.facetScopes.length > 0) {
    return {
      ...base,
      disposition: "quarantined",
      reasonCode: REASON.candidateMetadataDrift,
    };
  }
  return {
    ...base,
    disposition: context.policy.nonCandidate.disposition,
    reasonCode: context.policy.nonCandidate.reasonCode,
  };
}

function matchingScopes(
  bindings: readonly CompetitionBinding[],
  predicate: (binding: CompetitionBinding) => boolean,
): SourceScopeId[] {
  return bindings.filter(predicate).map((binding) => binding.selector.scope);
}

function assertMetadataEntity(
  entity: NormalizedSourceMetadata,
  registry: SportsSourceRegistry,
): void {
  if (!registry.sources.some((source) => source.key === entity.source)) {
    throw new Error(`metadata source is not registered: ${unbrand(entity.source)}`);
  }
  if (!entity.label.trim()) throw new Error("metadata label required");
  if (
    entity.sourceUpdatedAtMs !== undefined &&
    (!Number.isSafeInteger(entity.sourceUpdatedAtMs) || entity.sourceUpdatedAtMs < 0)
  ) {
    throw new Error("metadata sourceUpdatedAtMs must be a timestamp");
  }
  for (const [key, value] of Object.entries(entity.attributes)) {
    if (!key.trim() || !value.trim()) throw new Error("metadata attributes must be nonblank");
  }
  for (const [key, values] of Object.entries(entity.facets)) {
    if (!key.trim() || !Array.isArray(values)) throw new Error("metadata facets must be arrays");
    const seen = new Set<string>();
    for (const value of values) {
      if (typeof value !== "string" || !value.trim()) {
        throw new Error("metadata facet values must be nonblank strings");
      }
      if (seen.has(value)) throw new Error(`duplicate metadata facet value: ${key}:${value}`);
      seen.add(value);
    }
  }
}
