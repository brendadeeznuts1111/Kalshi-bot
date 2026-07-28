/**
 * regulatory/config.ts — Domain-scoped config accessor.
 *
 * Re-exports the regulatory slice from the global config loader
 * so regulatory modules don't need to know about the full schema.
 */

import { config } from "../lib/config";

/** Regulatory domain configuration (deep-frozen). */
export const regulatoryConfig = config.regulatory;

/** Shorthand aliases for the most frequently accessed values. */
export const {
  databasePath,
  defaultCountryCode,
  defaultUserId,
  rateLimiter,
  alerts,
  polymarket,
  migration,
} = regulatoryConfig;
