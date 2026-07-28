/**
 * ScopedRepository — generic repository with partner × state × user isolation.
 *
 * Every query is automatically injected with:
 *   node_id = ? AND country_code = ? AND sport_id = ? AND market_id = ?
 *   [AND state_code = ?] [AND user_id = ?]
 *
 * The injection guard rejects any SQL that already contains a direct filter on
 * one of the scoped dimensions (to prevent accidental double-filtering or
 * scope-escape). The marker `/*scope-injected* /` proves the clause was added
 * by us.
 */

import { Database } from "bun:sqlite";
import { SCOPE_INJECTION_MARKER } from "../constants";

export interface Scope {
  nodeId: string;
  country: string;
  sport: string;
  market: string;
  state?: string | null;   // optional state dimension
  user?: string | null;    // optional user dimension (for per-user queries)
}

export interface ScopedRow {
  node_id: string;
  country_code: string;
  sport_id: string;
  market_id: string;
  state_code: string | null;
  user_id: string | null;
}

export class ScopedRepository<T extends Record<string, unknown> = Record<string, unknown>> {
  constructor(
    private db: Database,
    private scope: Scope,
  ) {}

  /**
   * Injection guard: verify the SQL does NOT already contain a direct
   * dimension filter. If it does, throw — the caller may be trying to
   * bypass scope or has duplicated the filter.
   */
  private injectScope(sql: string): string {
    // Strip parenthetical sub-expressions so we don't flag VALUES clauses
    const stripped = sql.replace(/\([^()]*\)/g, "");
    const dimensionPatterns = [
      /node_id\s*=\s*\?/i,
      /country_code\s*=\s*\?/i,
      /sport_id\s*=\s*\?/i,
      /market_id\s*=\s*\?/i,
      /state_code\s*=\s*\?/i,
      /user_id\s*=\s*\?/i,
    ];

    for (const pat of dimensionPatterns) {
      if (pat.test(stripped) && !sql.includes(SCOPE_INJECTION_MARKER)) {
        throw new Error(
          `ScopedRepository: direct dimension filter detected (${pat.source}). ` +
            `Use ${SCOPE_INJECTION_MARKER} marker if intentional.`,
        );
      }
    }

    // Build scope clause with optional dimensions
    const parts = [
      `node_id = ?`,
      `country_code = ?`,
      `sport_id = ?`,
      `market_id = ?`,
    ];
    if (this.scope.state) parts.push(`state_code = ?`);
    if (this.scope.user) parts.push(`user_id = ?`);

    const scopeClause = `${parts.join(" AND ")} ${SCOPE_INJECTION_MARKER}`;

    // If SQL already has WHERE, prepend scope to existing conditions
    const whereMatch = sql.match(/^(.*?)\sWHERE\s+(.+)$/is);
    if (whereMatch) {
      const [, prefix, conditions] = whereMatch;
      return `${prefix} WHERE ${scopeClause} AND ${conditions}`;
    }

    // No WHERE but has FROM — append WHERE clause
    if (sql.toLowerCase().includes("from ")) {
      return `${sql} WHERE ${scopeClause}`;
    }

    throw new Error("ScopedRepository: cannot inject scope into SQL without FROM clause");
  }

  private buildParams(extra: unknown[] = []): unknown[] {
    const params: unknown[] = [
      this.scope.nodeId,
      this.scope.country,
      this.scope.sport,
      this.scope.market,
    ];
    if (this.scope.state) params.push(this.scope.state);
    if (this.scope.user) params.push(this.scope.user);
    return [...params, ...extra];
  }

  all(sql: string, ...params: unknown[]): T[] {
    const injected = this.injectScope(sql);
    return this.db.query(injected).all(...this.buildParams(params) as any) as T[];
  }

  get(sql: string, ...params: unknown[]): T | undefined {
    const injected = this.injectScope(sql);
    return this.db.query(injected).get(...this.buildParams(params) as any) as T | undefined;
  }

  run(sql: string, ...params: unknown[]): ReturnType<Database["run"]> {
    const injected = this.injectScope(sql);
    return this.db.run(injected, this.buildParams(params) as any);
  }
}
