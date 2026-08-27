// Companion test for src/regulatory/lib/audit.ts — immutable regulatory audit
// trail. Covers: log() optional-field branches, all convenience wrappers,
// byTrace() ordering/limit/details round-trip, summary() aggregations.
import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { AuditTrail } from '../../src/regulatory/lib/audit.ts';
import { TABLE } from '../../src/regulatory/constants.ts';

function makeDb(): Database {
  const db = new Database(':memory:');
  db.run(`CREATE TABLE ${TABLE.REGULATORY_AUDIT_LOG} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trace_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    outcome TEXT NOT NULL CHECK(outcome IN ('ok','blocked','error','flagged')),
    details TEXT,
    latency_ms INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  return db;
}

describe('AuditTrail', () => {
  test('log() inserts a full entry (all optional fields)', () => {
    const db = makeDb();
    new AuditTrail(db).log({
      traceId: 't-full',
      actor: 'compliance-agent',
      action: 'BET_PLACED',
      target: 'play-1',
      outcome: 'ok',
      details: { userId: 'u1', size: 5 },
      latencyMs: 12,
    });
    const row = db.query('SELECT * FROM ' + TABLE.REGULATORY_AUDIT_LOG).get() as Record<string, unknown>;
    expect(row.trace_id).toBe('t-full');
    expect(row.actor).toBe('compliance-agent');
    expect(row.action).toBe('BET_PLACED');
    expect(row.target).toBe('play-1');
    expect(row.outcome).toBe('ok');
    expect(row.details).toBe(JSON.stringify({ userId: 'u1', size: 5 }));
    expect(row.latency_ms).toBe(12);
    expect(typeof row.created_at).toBe('number');
  });

  test('log() writes NULL for absent optional fields', () => {
    const db = makeDb();
    new AuditTrail(db).log({ traceId: 't-min', actor: 'a', action: 'X', outcome: 'error' });
    const row = db.query('SELECT * FROM ' + TABLE.REGULATORY_AUDIT_LOG).get() as Record<string, unknown>;
    expect(row.target).toBeNull();
    expect(row.details).toBeNull();
    expect(row.latency_ms).toBeNull();
  });

  test('logBet() writes compliance-agent BET_PLACED with userId merged', () => {
    const db = makeDb();
    new AuditTrail(db).logBet('t-bet', 'play-9', 'u9', 'blocked', { venue: 'poly' }, 3);
    const row = db.query('SELECT * FROM ' + TABLE.REGULATORY_AUDIT_LOG).get() as Record<string, unknown>;
    expect(row.actor).toBe('compliance-agent');
    expect(row.action).toBe('BET_PLACED');
    expect(row.target).toBe('play-9');
    expect(row.outcome).toBe('blocked');
    expect(JSON.parse(row.details as string)).toEqual({ userId: 'u9', venue: 'poly' });
    expect(row.latency_ms).toBe(3);
  });

  test('logLineMove() writes flagged LINE_MOVE_DETECTED with delta/volume', () => {
    const db = makeDb();
    new AuditTrail(db).logLineMove('t-lm', 'will-it-rain', 25, 1400);
    const row = db.query('SELECT * FROM ' + TABLE.REGULATORY_AUDIT_LOG).get() as Record<string, unknown>;
    expect(row.actor).toBe('market-data-agent');
    expect(row.action).toBe('LINE_MOVE_DETECTED');
    expect(row.target).toBe('will-it-rain');
    expect(row.outcome).toBe('flagged');
    expect(JSON.parse(row.details as string)).toEqual({ deltaBp: 25, volumeAtMove: 1400 });
  });

  test('logDispatch() writes orchestrator AGENT_DISPATCH with role:taskType target', () => {
    const db = makeDb();
    new AuditTrail(db).logDispatch('t-d', 'compliance-agent', 'exclusion-review', 'ok', 7);
    const row = db.query('SELECT * FROM ' + TABLE.REGULATORY_AUDIT_LOG).get() as Record<string, unknown>;
    expect(row.actor).toBe('orchestrator');
    expect(row.action).toBe('AGENT_DISPATCH');
    expect(row.target).toBe('compliance-agent:exclusion-review');
    expect(row.outcome).toBe('ok');
    expect(row.latency_ms).toBe(7);
  });

  test('byTrace() orders newest-first, respects limit, parses details', () => {
    const db = makeDb();
    const trail = new AuditTrail(db);
    // Direct inserts with explicit created_at so ordering is deterministic.
    const insert = (id: string, created: number, details: string | null) =>
      db.run(
        'INSERT INTO ' + TABLE.REGULATORY_AUDIT_LOG +
        ' (trace_id, actor, action, target, outcome, details, latency_ms, created_at)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, 'actor', 'ACTION', 'tgt', 'ok', details, 1, created],
      );
    insert('t', 100, JSON.stringify({ seq: 1 }));
    insert('t', 300, null);
    insert('t', 200, JSON.stringify({ seq: 2 }));
    const rows = trail.byTrace('t');
    expect(rows.map((r) => r.createdAt)).toEqual([300, 200, 100]);
    expect(rows[0]!.details).toBeNull();
    expect((rows[1]!.details as Record<string, number>).seq).toBe(2);
    expect((rows[2]!.details as Record<string, number>).seq).toBe(1);
    expect(trail.byTrace('t', 2)).toHaveLength(2);
    expect(trail.byTrace('unknown')).toEqual([]);
  });

  test('summary() aggregates total/byActor/byOutcome/avgLatencyMs in window', () => {
    const db = makeDb();
    const trail = new AuditTrail(db);
    const insert = (created: number, actor: string, outcome: string, latency: number | null) =>
      db.run(
        'INSERT INTO ' + TABLE.REGULATORY_AUDIT_LOG +
        ' (trace_id, actor, action, outcome, latency_ms, created_at)' +
        ' VALUES (?, ?, ?, ?, ?, ?)',
        ['t', actor, 'ACT', outcome, latency, created],
      );
    insert(100, 'agent-a', 'ok', 5);
    insert(200, 'agent-a', 'blocked', null);
    insert(300, 'agent-b', 'ok', 15);
    insert(50, 'agent-old', 'ok', 1); // outside window (since=100)
    const s = trail.summary(100);
    expect(s.total).toBe(3);
    expect(s.byActor).toEqual({ 'agent-a': 2, 'agent-b': 1 });
    expect(s.byOutcome).toEqual({ ok: 2, blocked: 1 });
    expect(s.avgLatencyMs).toBe(10); // (5+15)/2 — null latency excluded
  });

  test('summary() on empty window returns zeroes and null avg', () => {
    const db = makeDb();
    const s = new AuditTrail(db).summary(0);
    expect(s.total).toBe(0);
    expect(s.byActor).toEqual({});
    expect(s.byOutcome).toEqual({});
    expect(s.avgLatencyMs).toBeNull();
  });
});
