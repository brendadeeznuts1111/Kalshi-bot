/**
 * Shared tabular schema + output helpers for Bun.inspect.table and Markdown.
 *
 * Field specs drive column presets, projection, and artifact schema documents.
 * Rendering uses native {@link Bun.inspect.table} (TTY) and GFM pipes (docs).
 *
 * @see https://bun.com/docs/runtime/utils#bun-inspect-table
 * @see https://bun.com/reference/bun/inspect/table
 * @see docs/BUN_TECH_STACK.md
 */
// @see https://bun.com/docs/runtime/utils#bun-inspect-table-tabulardata-properties-options

export type TableFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'number|null'
  | 'string|null'
  | 'boolean|null';

export type TableFieldAlign = 'left' | 'right' | 'center';

/** One column in a desk / export table. */
export type TableFieldSpec<K extends string = string> = {
  key: K;
  type: TableFieldType;
  description: string;
  /** Logical group for schema docs / column presets. */
  group?: string;
  align?: TableFieldAlign;
  /** Max cell width for markdown (default 120). */
  maxWidth?: number;
};

export type TableSchemaDocument<K extends string = string> = {
  schemaVersion: number;
  description: string;
  fields: readonly TableFieldSpec<K>[];
  groups?: Record<string, readonly K[]>;
  presets?: Record<string, readonly K[]>;
  defaultColumns: readonly K[];
  allColumns: readonly K[];
};

export type ProjectOptions = {
  /** Empty cells become this (default "—"). */
  empty?: string;
  /** When true, only include keys present in each row (default false). */
  sparse?: boolean;
};

/**
 * Resolve a preset name or explicit column list against known presets / all keys.
 * Special value `"all"` expands to every schema column.
 */
export function resolveTableColumns<K extends string>(
  requested: readonly string[] | undefined,
  presets: Record<string, readonly K[]>,
  allColumns: readonly K[],
  defaultColumns: readonly K[],
): K[] {
  if (!requested?.length) return [...defaultColumns];
  if (requested.length === 1) {
    const only = requested[0]!;
    if (only === 'all') return [...allColumns];
    if (presets[only]) return [...presets[only]!];
  }
  const known = new Set<string>(allColumns);
  const out: K[] = [];
  for (const c of requested) {
    if (c === 'all') {
      for (const k of allColumns) if (!out.includes(k)) out.push(k);
      continue;
    }
    if (presets[c]) {
      for (const k of presets[c]!) if (!out.includes(k)) out.push(k);
      continue;
    }
    if (known.has(c)) out.push(c as K);
  }
  return out.length ? out : [...defaultColumns];
}

/** Project full rows onto a column list for inspect.table / markdown. */
export function projectTableRows<T extends Record<string, unknown>>(
  rows: readonly T[],
  columns: readonly string[],
  options: ProjectOptions = {},
): Array<Record<string, string | number | boolean | null>> {
  const empty = options.empty ?? '—';
  return rows.map(row => {
    const o: Record<string, string | number | boolean | null> = {};
    for (const c of columns) {
      const v = row[c];
      if (v === undefined || v === null || v === '') {
        o[c] = options.sparse ? null : empty;
      } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        o[c] = v;
      } else {
        o[c] = String(v);
      }
    }
    return o;
  });
}

export type MarkdownTableOptions = {
  maxCellWidth?: number;
  /** Per-column align overrides; else field specs; else left. */
  align?: Record<string, TableFieldAlign>;
  empty?: string;
};

function markdownAlignSep(align: TableFieldAlign | undefined): string {
  if (align === 'right') return '---:';
  if (align === 'center') return ':---:';
  return '---';
}

function cellMarkdown(
  value: unknown,
  maxWidth: number,
  empty: string,
): string {
  const s = value == null || value === '' ? empty : String(value);
  const escaped = s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  if (escaped.length <= maxWidth) return escaped;
  if (maxWidth <= 1) return '…';
  return `${escaped.slice(0, maxWidth - 1)}…`;
}

/**
 * GFM markdown table. Alignment via options or field specs (right for numbers).
 */
export function formatMarkdownTable(
  rows: Array<Record<string, unknown>>,
  columns: readonly string[],
  options: MarkdownTableOptions & {
    fields?: readonly TableFieldSpec[];
  } = {},
): string {
  if (!rows.length) return '(no rows)';
  const empty = options.empty ?? '—';
  const maxDefault = options.maxCellWidth ?? 120;
  const fieldByKey = new Map((options.fields ?? []).map(f => [f.key, f]));
  const alignOf = (c: string): TableFieldAlign => {
    if (options.align?.[c]) return options.align[c]!;
    const f = fieldByKey.get(c);
    if (f?.align) return f.align;
    if (f?.type === 'number' || f?.type === 'number|null') return 'right';
    return 'left';
  };
  const maxOf = (c: string) => fieldByKey.get(c)?.maxWidth ?? maxDefault;

  const header = '| ' + columns.join(' | ') + ' |';
  const sep =
    '| ' + columns.map(c => markdownAlignSep(alignOf(c))).join(' | ') + ' |';
  const body = rows.map(
    r =>
      '| ' +
      columns
        .map(c => cellMarkdown(r[c], maxOf(c), empty))
        .join(' | ') +
      ' |',
  );
  return [header, sep, ...body].join('\n');
}

export type InspectTableOptions = {
  colors?: boolean;
};

/**
 * Bun.inspect.table string for TTY/desk output.
 * @see https://bun.com/docs/runtime/utils#bun-inspect-table
 */
export function formatInspectTableFromRows(
  rows: Array<Record<string, unknown>>,
  columns: readonly string[],
  options: InspectTableOptions = {},
): string {
  if (!rows.length) return '(no rows)\n';
  // @see https://bun.com/docs/runtime/utils#bun-inspect-table
  const table = Bun.inspect.table(rows, [...columns], {
    colors: options.colors ?? false,
  });
  return table.endsWith('\n') ? table : `${table}\n`;
}

/** Group field keys by `group` property (order = first appearance). */
export function groupFieldKeys<K extends string>(
  fields: readonly TableFieldSpec<K>[],
): Record<string, K[]> {
  const groups: Record<string, K[]> = {};
  for (const f of fields) {
    const g = f.group ?? 'default';
    (groups[g] ??= []).push(f.key);
  }
  return groups;
}

/** Build a JSON-serializable schema document for artifacts / CLI --schema. */
export function buildTableSchemaDocument<K extends string>(input: {
  schemaVersion: number;
  description: string;
  fields: readonly TableFieldSpec<K>[];
  presets?: Record<string, readonly K[]>;
  defaultColumns: readonly K[];
}): TableSchemaDocument<K> {
  const allColumns = input.fields.map(f => f.key);
  return {
    schemaVersion: input.schemaVersion,
    description: input.description,
    fields: input.fields,
    groups: groupFieldKeys(input.fields),
    ...(input.presets !== undefined ? { presets: input.presets } : {}),
    defaultColumns: input.defaultColumns,
    allColumns,
  };
}
