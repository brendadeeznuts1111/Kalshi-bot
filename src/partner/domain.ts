/**
 * @deprecated Import from `./architecture.ts`.
 *
 * Seat-ops architecture (not desk matrix `src/domain/`).
 * Remove this shim after callers migrate (target: next release).
 *
 * `PARTNER_DOMAIN_LAYERS` is **only** re-exported here — not from partner/index.ts.
 */
export {
  OPS_LAYERS,
  OPS_LAYERS as PARTNER_DOMAIN_LAYERS,
  PARTNER_NAMING,
  buildOpsStatusReport,
  buildDomainStatusReport,
  formatOpsStatusText,
  formatDomainStatusText,
  formatPartnerExpansionMermaid,
  type OpsComponent,
  type OpsLayer,
  type OpsLayerId,
  type OpsMaturity,
  type OpsStatusReport,
  type DomainComponent,
  type DomainLayer,
  type DomainLayerId,
  type DomainMaturity,
  type DomainStatusReport,
} from './architecture.ts';
