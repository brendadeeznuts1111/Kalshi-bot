#!/usr/bin/env bun
/**
 * Validate partner-ops glossary concept ids + ColorKeys against GLOSSARY_ENTRIES.
 *
 *   bun run partners:validate
 *
 * Factory registry bake stays in FactoryWager (`bun run partners:validate` there).
 * This gate proves the Kalshi domain glossary owns the shared taxonomy ids.
 */
import {
  GLOSSARY_ENTRIES,
  PAGE_SURFACES,
  getGlossaryEntry,
} from '../src/institutions/glossary.ts';
import { isColorKey } from '../src/lib/color/index.ts';

/** Shared partner-ops concept ids owned by Kalshi glossary (not Factory telegram.*). */
export const KALSHI_PARTNER_OPS_CONCEPT_IDS = [
  'partner.phase.operator_ready',
  'partner.phase.onboarding',
  'partner.phase.incomplete',
  'partner.phase.paused',
  'book.type.legal',
  'book.type.offshore',
  'book.type.pph',
  'book.type.crypto',
  'deposit.method.venmo',
  'deposit.method.crypto',
  'deposit.method.wire',
  'deposit.method.credit',
  'out.status.ready',
  'out.status.deferred',
  'out.status.paused',
  'accounting.deposit',
  'accounting.withdrawal',
  'accounting.credit',
  'accounting.free_roll',
  'accounting.settlement',
  'event.partner.registered',
  'event.partner.phase_change',
  'event.out.created',
  'event.out.status_change',
  'event.deposit.received',
  'event.deposit.allocated',
  'event.credit.extended',
  'event.free_roll.applied',
  'event.settlement.processed',
  'event.telegram.invite_sent',
  'event.telegram.message_pinned',
  'partner.authorization.request',
  'partner.authorization.grant',
  'partner.execution.gate',
  'partner.execution.reservation',
  'partner.execution.provider_lifecycle',
  'partner.execution.journal',
  'partner.execution.receipt',
  'provider.polymarket.intelligence_only',
] as const;

const EXPECTED_KIND: Record<(typeof KALSHI_PARTNER_OPS_CONCEPT_IDS)[number], 'ui' | 'composite'> = {
  'partner.phase.operator_ready': 'ui',
  'partner.phase.onboarding': 'ui',
  'partner.phase.incomplete': 'ui',
  'partner.phase.paused': 'ui',
  'book.type.legal': 'ui',
  'book.type.offshore': 'ui',
  'book.type.pph': 'ui',
  'book.type.crypto': 'ui',
  'deposit.method.venmo': 'ui',
  'deposit.method.crypto': 'ui',
  'deposit.method.wire': 'ui',
  'deposit.method.credit': 'ui',
  'out.status.ready': 'ui',
  'out.status.deferred': 'ui',
  'out.status.paused': 'ui',
  'accounting.deposit': 'composite',
  'accounting.withdrawal': 'composite',
  'accounting.credit': 'composite',
  'accounting.free_roll': 'composite',
  'accounting.settlement': 'composite',
  'event.partner.registered': 'composite',
  'event.partner.phase_change': 'composite',
  'event.out.created': 'composite',
  'event.out.status_change': 'composite',
  'event.deposit.received': 'composite',
  'event.deposit.allocated': 'composite',
  'event.credit.extended': 'composite',
  'event.free_roll.applied': 'composite',
  'event.settlement.processed': 'composite',
  'event.telegram.invite_sent': 'composite',
  'event.telegram.message_pinned': 'composite',
  'partner.authorization.request': 'composite',
  'partner.authorization.grant': 'composite',
  'partner.execution.gate': 'composite',
  'partner.execution.reservation': 'composite',
  'partner.execution.provider_lifecycle': 'composite',
  'partner.execution.journal': 'composite',
  'partner.execution.receipt': 'composite',
  'provider.polymarket.intelligence_only': 'composite',
};

const errs: string[] = [];

for (const id of KALSHI_PARTNER_OPS_CONCEPT_IDS) {
  const entry = getGlossaryEntry(id);
  if (!entry) {
    errs.push(`missing glossary entry: ${id}`);
    continue;
  }
  if (entry.kind !== EXPECTED_KIND[id]) {
    errs.push(`${id}: kind ${entry.kind} (expected ${EXPECTED_KIND[id]})`);
  }
  if (!entry.color || !isColorKey(entry.color)) {
    errs.push(`${id}: missing/invalid ColorKey`);
  }
  if (!PAGE_SURFACES.ops.includes(id)) {
    errs.push(`${id}: not listed on PAGE_SURFACES.ops`);
  }
}

const ids = GLOSSARY_ENTRIES.map(e => e.id);
if (new Set(ids).size !== ids.length) {
  errs.push('duplicate ids in GLOSSARY_ENTRIES');
}

const ok = errs.length === 0;
console.log(`Partner-ops glossary validation: ${ok ? 'PASS' : 'FAIL'} (${KALSHI_PARTNER_OPS_CONCEPT_IDS.length} concepts)`);
for (const e of errs) console.error(`  ✗ ${e}`);
if (!ok) process.exit(1);
