import type {
  AdapterDefinition,
  SourceDefinition,
  SportDefinition,
  SportSourceRegistration,
} from "./types.ts";

/** Compile-time registration templates. Runtime invariants live in validate.ts. */
export function defineSport<T extends SportDefinition>(definition: T): T {
  return definition;
}

export function defineSource<T extends SourceDefinition>(definition: T): T {
  return definition;
}

export function defineAdapter<T extends AdapterDefinition>(definition: T): T {
  return definition;
}

export function defineIntegration<T extends SportSourceRegistration>(definition: T): T {
  return definition;
}
