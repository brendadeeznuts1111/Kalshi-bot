// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  OPS_LAYERS,
  PARTNER_NAMING,
  buildOpsStatusReport,
  formatOpsStatusText,
  formatPartnerExpansionMermaid,
} from '../../src/partner/architecture.ts';

describe('seat-ops architecture (not desk domain matrix)', () => {
  test('five layers with honest maturity counts', () => {
    expect(OPS_LAYERS.map(l => l.id)).toEqual([
      'partner',
      'communication',
      'accounts',
      'assets',
      'finance',
    ]);
    const report = buildOpsStatusReport();
    expect(report.totals.components).toBeGreaterThan(10);
    expect(report.totals.built).toBeGreaterThan(0);
    expect(report.totals.partial).toBeGreaterThan(0);
    expect(report.totals.planned).toBe(0);
    expect(report.orchestration.missingForBotLoop.length).toBeGreaterThan(0);
    expect(report.orchestration.clis).toContain('ops:status');
    expect(report.orchestration.clis).toContain('domain:skins');
    expect(report.orchestration.clis).not.toContain('domain:status');
    expect(PARTNER_NAMING.outIdExample).toBe('out-SPEN-1');
    expect(PARTNER_NAMING.bookIdExample).toBe('fantasy402');
    expect(PARTNER_NAMING.skinIdExample).toBe('buckeye');
    expect(formatOpsStatusText(report)).toContain('seat ops');
  });

  test('deprecated partner/domain.ts shim only re-exports (kill 2026-09-01)', async () => {
    const shim = await import('../../src/partner/domain.ts');
    expect(shim.OPS_LAYERS).toBe(OPS_LAYERS);
    expect(shim.PARTNER_DOMAIN_LAYERS).toBe(OPS_LAYERS);
    expect(shim.buildDomainStatusReport().totals.components).toBe(
      buildOpsStatusReport().totals.components
    );
  });

  test('expansion map distinguishes built execution from intelligence and unwired providers', () => {
    const map = formatPartnerExpansionMermaid();
    expect(map).toContain('Telegram group/topic');
    expect(map).toContain('Kalshi V2 execution');
    expect(map).toContain('Polymarket Gamma market data');
    expect(map).toContain('Polymarket execution adapter<br/>not implemented');
    expect(map).toContain('future provider-parity contract');
    expect(map).toContain('blocked pending idempotency contract');
  });
});
