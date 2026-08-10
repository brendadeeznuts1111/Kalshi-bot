/**
 * @deprecated Import from `./architecture.ts`.
 *
 * Seat-ops architecture (not desk matrix `src/domain/`).
 * Kill: remove this file after 2026-09-01 once callers use architecture.ts only.
 *
 * Deprecated names (`PARTNER_DOMAIN_LAYERS`, `Domain*`, `buildDomainStatusReport`)
 * live **only** here — not on architecture.ts or partner/index.ts.
 */
export {
  OPS_LAYERS,
  PARTNER_NAMING,
  buildOpsStatusReport,
  formatOpsStatusText,
  formatPartnerExpansionMermaid,
  type OpsComponent,
  type OpsLayer,
  type OpsLayerId,
  type OpsMaturity,
  type OpsStatusReport,
} from './architecture.ts';

import {
  OPS_LAYERS,
  buildOpsStatusReport,
  formatOpsStatusText,
  type OpsComponent,
  type OpsLayer,
  type OpsLayerId,
  type OpsMaturity,
  type OpsStatusReport,
} from './architecture.ts';

/** @deprecated Use OPS_LAYERS */
export const PARTNER_DOMAIN_LAYERS = OPS_LAYERS;

/** @deprecated Use OpsLayerId */
export type DomainLayerId = OpsLayerId;
/** @deprecated Use OpsMaturity */
export type DomainMaturity = OpsMaturity;
/** @deprecated Use OpsComponent */
export type DomainComponent = OpsComponent;
/** @deprecated Use OpsLayer */
export type DomainLayer = OpsLayer;
/** @deprecated Use OpsStatusReport */
export type DomainStatusReport = OpsStatusReport;

/** @deprecated Use buildOpsStatusReport */
export function buildDomainStatusReport(nowMs = Date.now()): OpsStatusReport {
  return buildOpsStatusReport(nowMs);
}

/** @deprecated Use formatOpsStatusText */
export function formatDomainStatusText(report: OpsStatusReport): string {
  return formatOpsStatusText(report);
}
