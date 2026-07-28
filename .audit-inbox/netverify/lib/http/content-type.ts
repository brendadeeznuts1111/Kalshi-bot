// @see https://bun.com/docs/runtime/networking/fetch#content-type-handling — request body Content-Type
// @see https://bun.com/docs/runtime/networking/fetch — fetch
// @see https://bun.com/docs/guides/http/file-uploads#upload-files-via-http-using-formdata — FormData upload
// @see https://bun.com/docs/runtime/utils#bun-inspect-table — Bun.inspect.table
/**
 * Content-Type decision matrix — four+ columns, never a single fuzzy string.
 *
 * | column | meaning |
 * |--------|---------|
 * | **defaultValue** | Bun auto CT when header omitted |
 * | **ourValue** | What we set (or `—` if we defer) |
 * | **wireValue** | Observed on Request/Response after build (optional) |
 * | **expected** | Contract for this surface |
 * | **status** | ok · mismatch · missing · override · defer · unknown |
 * | **severity** | pass · warn · fail |
 *
 * Bun request-body rules (header omitted):
 *   FormData → multipart/form-data; boundary=…  (never set CT yourself)
 *   Blob/File → blob.type
 *   string / Uint8Array → nothing
 */
export const CT_JSON = 'application/json; charset=utf-8';
export const CT_HTML = 'text/html; charset=utf-8';
export const CT_TEXT = 'text/plain; charset=utf-8';
export const CT_JS = 'text/javascript; charset=utf-8';
export const CT_CSS = 'text/css; charset=utf-8';
export const CT_SSE = 'text/event-stream; charset=utf-8';
export const CT_SVG = 'image/svg+xml';
export const CT_GZIP = 'application/gzip';
export const CT_OCTET = 'application/octet-stream';
export const CT_EMPTY = '';

/** Decision status (policy engine). */
export type ContentTypeStatus =
  | 'ok' // contract satisfied
  | 'mismatch' // our/wire ≠ expected
  | 'missing' // expected set, nothing on wire/our
  | 'override' // we set CT when Bun must own it (FormData)
  | 'defer' // we leave empty; Bun default applies (informational)
  | 'unknown';

export type ContentTypeSeverity = 'pass' | 'warn' | 'fail';

export type ContentTypeSide = 'request' | 'response';

/**
 * Separated Content-Type decision.
 * Always use these columns — do not collapse to one string.
 */
export type ContentTypeDecision = {
  id: string; // brand-ok — opaque matrix row key
  label: string;
  side: ContentTypeSide;
  /** Bun automatic value when CT header omitted. */
  defaultValue: string;
  /** FactoryWager explicit header (`—` if we defer). */
  ourValue: string;
  /**
   * Observed header after Request/Response is built (optional).
   * For FormData this includes the boundary suffix.
   */
  wireValue: string;
  /** Contract media type / full CT. */
  expected: string;
  status: ContentTypeStatus;
  severity: ContentTypeSeverity;
  match: {
    ourVsExpected: boolean;
    defaultVsExpected: boolean;
    wireVsExpected: boolean;
  };
  note?: string;
  /** Mechanism: how default is produced. */
  bunMechanism?: 'formdata-multipart' | 'blob-type' | 'none' | 'response-explicit';
};

export type ContentTypeMatrixSummary = {
  total: number;
  pass: number;
  warn: number;
  fail: number;
  byStatus: Record<ContentTypeStatus, number>;
  rows: ContentTypeDecision[];
};

// ── Normalization ───────────────────────────────────────────────────

/** Media type only, lowercased; multipart collapses to family. */
export function normalizeContentType(ct: string | null | undefined): string {
  if (ct == null || ct.trim() === '' || ct === '—') return '';
  const base = ct.split(';')[0]!.trim().toLowerCase();
  if (base.startsWith('multipart/form-data')) return 'multipart/form-data';
  if (base === 'application/json' || base.endsWith('+json')) return 'application/json';
  if (base === 'text/javascript' || base === 'application/javascript') return 'text/javascript';
  return base;
}

/** Display cell: empty → em dash. */
export function displayCt(ct: string | null | undefined): string {
  if (ct == null || ct === '' || ct === '—') return '—';
  return ct;
}

export function isJsonContentType(ct: string | null | undefined): boolean {
  return normalizeContentType(ct) === 'application/json';
}

export function isMultipartContentType(ct: string | null | undefined): boolean {
  return normalizeContentType(ct) === 'multipart/form-data';
}

function matchesExpected(actual: string, expected: string): boolean {
  const a = normalizeContentType(actual);
  const e = normalizeContentType(expected);
  if (e === '') return a === '';
  if (a === '') return false;
  return a === e;
}

function severityFor(status: ContentTypeStatus): ContentTypeSeverity {
  switch (status) {
    case 'ok':
    case 'defer':
      return 'pass';
    case 'override':
    case 'mismatch':
    case 'missing':
      return 'fail';
    default:
      return 'warn';
  }
}

// ── Core evaluator ──────────────────────────────────────────────────

/**
 * Pure scorer: defaultValue | ourValue | wireValue | expected → status.
 *
 * Priority:
 * 1. FormData family → our must be empty (override if set); wire/default must be multipart
 * 2. If our set → compare our vs expected
 * 3. If our empty → wire or default must satisfy expected
 */
export function evaluateContentType(input: {
  id: string; // brand-ok
  label: string;
  side: ContentTypeSide;
  defaultValue?: string | null;
  ourValue?: string | null;
  wireValue?: string | null;
  expected?: string | null;
  note?: string;
  bunMechanism?: ContentTypeDecision['bunMechanism'];
}): ContentTypeDecision {
  const defaultValue = input.defaultValue ?? '';
  const ourValue = input.ourValue ?? '';
  const wireValue = input.wireValue ?? '';
  const expected = input.expected ?? '';

  const def = normalizeContentType(defaultValue);
  const our = normalizeContentType(ourValue);
  const wire = normalizeContentType(wireValue);
  const exp = normalizeContentType(expected);

  const ourVsExpected = our === '' ? def === exp || wire === exp : matchesExpected(ourValue, expected);
  const defaultVsExpected = exp === '' ? def === '' : matchesExpected(defaultValue, expected);
  const wireVsExpected =
    wire === ''
      ? our === ''
        ? defaultVsExpected
        : ourVsExpected
      : matchesExpected(wireValue, expected);

  let status: ContentTypeStatus = 'unknown';

  const isMultipartContract =
    exp === 'multipart/form-data' || def === 'multipart/form-data';

  if (isMultipartContract) {
    // Never set Content-Type ourselves on FormData
    if (our !== '') status = 'override';
    else if (wire !== '' && wire !== 'multipart/form-data') status = 'mismatch';
    else if (wire === 'multipart/form-data' || def === 'multipart/form-data') status = 'ok';
    else status = 'missing';
  } else if (exp === '') {
    status = our === '' && wire === '' ? 'ok' : our !== '' || wire !== '' ? 'ok' : 'unknown';
  } else if (our !== '') {
    status = matchesExpected(ourValue, expected) ? 'ok' : 'mismatch';
  } else if (wire !== '') {
    status = matchesExpected(wireValue, expected) ? 'ok' : 'mismatch';
  } else if (def !== '') {
    status = matchesExpected(defaultValue, expected) ? 'ok' : 'mismatch';
  } else {
    status = 'missing';
  }

  return {
    id: input.id,
    label: input.label,
    side: input.side,
    defaultValue: displayCt(defaultValue),
    ourValue: displayCt(ourValue),
    wireValue: displayCt(wireValue),
    expected: displayCt(expected),
    status,
    severity: severityFor(status),
    match: {
      ourVsExpected: our === '' ? defaultVsExpected || wireVsExpected : ourVsExpected,
      defaultVsExpected,
      wireVsExpected,
    },
    note: input.note,
    bunMechanism: input.bunMechanism,
  };
}

// ── Bun default / our policy / expected ─────────────────────────────

export function bunDefaultContentType(body: BodyInit | null | undefined): {
  value: string;
  mechanism: ContentTypeDecision['bunMechanism'];
} {
  if (body == null) return { value: '', mechanism: 'none' };
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return { value: 'multipart/form-data', mechanism: 'formdata-multipart' };
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return { value: body.type || '', mechanism: 'blob-type' };
  }
  return { value: '', mechanism: 'none' };
}

export function ourContentTypeForBody(body: BodyInit | null | undefined): string {
  if (body == null) return '';
  if (typeof FormData !== 'undefined' && body instanceof FormData) return '';
  if (typeof Blob !== 'undefined' && body instanceof Blob) return '';
  if (typeof body === 'string') {
    const t = body.trimStart();
    if (t.startsWith('{') || t.startsWith('[')) return CT_JSON;
    return CT_TEXT;
  }
  if (body instanceof Uint8Array || ArrayBuffer.isView(body) || body instanceof ArrayBuffer) {
    return '';
  }
  return '';
}

export function expectedContentTypeForBody(body: BodyInit | null | undefined): string {
  if (body == null) return '';
  if (typeof FormData !== 'undefined' && body instanceof FormData) return 'multipart/form-data';
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    if (body.type) return normalizeContentType(body.type) || '';
    return '';
  }
  if (typeof body === 'string') {
    const t = body.trimStart();
    if (t.startsWith('{') || t.startsWith('[')) return 'application/json';
    return 'text/plain';
  }
  return '';
}

// ── Decide request / response / wire ────────────────────────────────

export function decideRequestContentType(
  body: BodyInit | null | undefined,
  opts?: {
    id?: string; // brand-ok
    label?: string;
    /** undefined = policy; set string (incl '') to force our header for demos */
    explicitOurHeader?: string;
  }
): ContentTypeDecision {
  const { value: defaultValue, mechanism } = bunDefaultContentType(body);
  const ourValue =
    opts?.explicitOurHeader !== undefined ? opts.explicitOurHeader : ourContentTypeForBody(body);
  const expected = expectedContentTypeForBody(body);

  // Probe wire: build a Request and read Content-Type Bun assigned
  let wireValue = '';
  if (body != null && opts?.explicitOurHeader === undefined) {
    try {
      const req = new Request('http://content-type.test/probe', {
        method: 'POST',
        body,
      });
      wireValue = req.headers.get('content-type') || '';
    } catch {
      wireValue = '';
    }
  } else if (opts?.explicitOurHeader !== undefined && body != null) {
    try {
      const headers: HeadersInit =
        opts.explicitOurHeader === ''
          ? {}
          : { 'Content-Type': opts.explicitOurHeader };
      const req = new Request('http://content-type.test/probe', {
        method: 'POST',
        headers,
        body,
      });
      wireValue = req.headers.get('content-type') || '';
    } catch {
      wireValue = opts.explicitOurHeader;
    }
  }

  return evaluateContentType({
    id: opts?.id ?? 'request-body',
    label: opts?.label ?? 'request body',
    side: 'request',
    defaultValue,
    ourValue,
    wireValue,
    expected,
    bunMechanism: mechanism,
    note:
      mechanism === 'formdata-multipart'
        ? 'never set Content-Type on FormData fetch'
        : mechanism === 'blob-type'
          ? 'Bun uses blob.type when header omitted'
          : mechanism === 'none'
            ? 'string/bytes need explicit CT or jsonBlob()'
            : undefined,
  });
}

export function decideResponseContentType(
  path: string,
  ourValue?: string,
  wireValue?: string
): ContentTypeDecision {
  const expected = guessContentType(path);
  const our = ourValue ?? expected;
  return evaluateContentType({
    id: `response:${path}`,
    label: path,
    side: 'response',
    defaultValue: '',
    ourValue: our,
    wireValue: wireValue ?? our,
    expected,
    bunMechanism: 'response-explicit',
    note: 'Response CT is always explicit (no Bun auto)',
  });
}

/** Evaluate a live Response against path expectation. */
export function decideFromResponse(path: string, res: Response): ContentTypeDecision {
  const wire = res.headers.get('content-type') || '';
  return decideResponseContentType(path, undefined, wire);
}

/** Evaluate a live Request (e.g. after client built it). */
export function decideFromRequest(
  req: Request,
  opts?: { id?: string; label?: string; expected?: string }
): ContentTypeDecision {
  const wire = req.headers.get('content-type') || '';
  const expected = opts?.expected ?? (isMultipartContentType(wire) ? 'multipart/form-data' : wire);
  return evaluateContentType({
    id: opts?.id ?? 'live-request',
    label: opts?.label ?? req.url,
    side: 'request',
    defaultValue: isMultipartContentType(wire) ? 'multipart/form-data' : '',
    ourValue: '', // unknown without policy context
    wireValue: wire,
    expected,
    note: 'live Request header probe',
  });
}

// ── Response path matrix (serve-public surfaces) ────────────────────

/** Paths we serve + expected CT (registry portal contract). */
export const RESPONSE_PATH_MATRIX: ReadonlyArray<{ path: string; expected?: string }> = [
  { path: '/registry/ops-summary.json' },
  { path: '/registry/static.json' },
  { path: '/registry/monitoring.json' },
  { path: '/registry/registry.json' },
  { path: '/registry/prediction/report.html' },
  { path: '/registry/prediction/coverage-chart.svg' },
  { path: '/registry/prediction/error-chart.svg' },
  { path: '/registry/@factorywager/bun-utils-test/latest.json' },
  { path: '/registry/@factorywager/routing-test/latest.json' },
  { path: '/portal/index.html' },
  { path: '/portal/ops/index.html' },
  { path: '/portal/style.css' },
  { path: '/portal/app.js' },
  { path: '/portal/operations-dashboard.js' },
  { path: 'artifact.tgz' },
];

// ── Catalog + summary ───────────────────────────────────────────────

export function contentTypePolicyCatalog(): ContentTypeDecision[] {
  const form = new FormData();
  form.set('file', jsonFile({ ok: true }, 'x.json'));
  const emptyForm = new FormData();
  emptyForm.set('name', 'text-only');
  const jsonB = jsonBlob({ a: 1 });
  const gzipBlob = new Blob([new Uint8Array([0x1f, 0x8b])], { type: 'application/gzip' });
  const bareBlob = new Blob([new Uint8Array([1, 2, 3])]); // no type
  const plainJson = JSON.stringify({ a: 1 });
  const plainText = 'hello';
  const bytes = new Uint8Array([1, 2, 3]);

  const requestRows: ContentTypeDecision[] = [
    decideRequestContentType(form, {
      id: 'formdata-file-upload',
      label: 'FormData + File (publish)',
    }),
    decideRequestContentType(emptyForm, {
      id: 'formdata-fields-only',
      label: 'FormData fields only',
    }),
    decideRequestContentType(form, {
      id: 'formdata-manual-ct-override',
      label: 'FormData + manual Content-Type (bad)',
      explicitOurHeader: 'multipart/form-data',
    }),
    decideRequestContentType(form, {
      id: 'formdata-wrong-ct-override',
      label: 'FormData + application/json CT (bad)',
      explicitOurHeader: CT_JSON,
    }),
    decideRequestContentType(jsonB, {
      id: 'json-blob',
      label: 'JSON Blob (jsonBlob())',
    }),
    decideRequestContentType(gzipBlob, {
      id: 'gzip-blob',
      label: 'gzip Blob artifact',
    }),
    decideRequestContentType(bareBlob, {
      id: 'bare-blob',
      label: 'Blob without type',
    }),
    decideRequestContentType(plainJson, {
      id: 'json-string-with-policy',
      label: 'JSON string (we set CT)',
    }),
    decideRequestContentType(plainJson, {
      id: 'json-string-missing-ct',
      label: 'JSON string + no CT (bad)',
      explicitOurHeader: '',
    }),
    decideRequestContentType(plainText, {
      id: 'plain-string',
      label: 'plain text string',
    }),
    decideRequestContentType(bytes, {
      id: 'uint8array',
      label: 'Uint8Array body',
    }),
  ];

  const responseRows = RESPONSE_PATH_MATRIX.map(({ path, expected }) => {
    const d = decideResponseContentType(
      path.startsWith('/') ? `public${path}` : path,
      expected
    );
    return d;
  });

  responseRows.push(
    evaluateContentType({
      id: 'response-json-api',
      label: 'Response.json /api/*',
      side: 'response',
      defaultValue: '',
      ourValue: CT_JSON,
      wireValue: CT_JSON,
      expected: CT_JSON,
      bunMechanism: 'response-explicit',
    }),
    evaluateContentType({
      id: 'response-sse-hmr',
      label: 'SSE /__hmr',
      side: 'response',
      defaultValue: '',
      ourValue: CT_SSE,
      wireValue: CT_SSE,
      expected: CT_SSE,
      bunMechanism: 'response-explicit',
      note: 'live-reload EventSource',
    }),
    evaluateContentType({
      id: 'response-health-plain',
      label: '/health/pre text',
      side: 'response',
      defaultValue: '',
      ourValue: CT_TEXT,
      wireValue: CT_TEXT,
      expected: CT_TEXT,
      bunMechanism: 'response-explicit',
    })
  );

  return [...requestRows, ...responseRows];
}

export function summarizeContentTypeMatrix(
  rows: ContentTypeDecision[] = contentTypePolicyCatalog()
): ContentTypeMatrixSummary {
  const byStatus: Record<ContentTypeStatus, number> = {
    ok: 0,
    mismatch: 0,
    missing: 0,
    override: 0,
    defer: 0,
    unknown: 0,
  };
  let pass = 0;
  let warn = 0;
  let fail = 0;
  for (const r of rows) {
    byStatus[r.status]++;
    if (r.severity === 'pass') pass++;
    else if (r.severity === 'warn') warn++;
    else fail++;
  }
  return { total: rows.length, pass, warn, fail, byStatus, rows };
}

/** Flat table rows: defaultValue | ourValue | wireValue | expected | status | severity */
export function contentTypePolicyTableRows(
  rows: ContentTypeDecision[] = contentTypePolicyCatalog()
): Array<Record<string, string>> {
  return rows.map(r => ({
    id: r.id,
    side: r.side,
    defaultValue: r.defaultValue,
    ourValue: r.ourValue,
    wireValue: r.wireValue,
    expected: r.expected,
    status: r.status,
    severity: r.severity,
    mechanism: r.bunMechanism ?? '',
    note: r.note ?? '',
  }));
}

/**
 * Live probe: GET paths against base URL, score wire Content-Type vs guess.
 */
export async function probeLiveContentTypes(
  baseUrl: string,
  paths: string[] = RESPONSE_PATH_MATRIX.filter(p => p.path.startsWith('/')).map(p => p.path)
): Promise<ContentTypeDecision[]> {
  const base = baseUrl.replace(/\/$/, '');
  const out: ContentTypeDecision[] = [];
  for (const path of paths) {
    const url = `${base}${path}`;
    try {
      const res = await fetch(url, { redirect: 'follow' });
      const wire = res.headers.get('content-type') || '';
      const expected = guessContentType(path.startsWith('/') ? `public${path}` : path);
      out.push(
        evaluateContentType({
          id: `live:${path}`,
          label: path,
          side: 'response',
          defaultValue: '',
          ourValue: expected,
          wireValue: wire,
          expected,
          bunMechanism: 'response-explicit',
          note: `HTTP ${res.status}`,
        })
      );
    } catch (e) {
      out.push(
        evaluateContentType({
          id: `live:${path}`,
          label: path,
          side: 'response',
          defaultValue: '',
          ourValue: '',
          wireValue: '',
          expected: guessContentType(`public${path}`),
          note: e instanceof Error ? e.message : String(e),
        })
      );
    }
  }
  return out;
}

// ── Body builders ───────────────────────────────────────────────────

// eslint-disable-next-line harness/no-unknown-function-param -- wire JSON
export function jsonBlob(data: unknown): Blob {
  return new Blob([`${JSON.stringify(data)}\n`], { type: 'application/json' });
}

// eslint-disable-next-line harness/no-unknown-function-param -- wire JSON
export function jsonFile(data: unknown, filename = 'payload.json'): File {
  return new File([`${JSON.stringify(data, null, 2)}\n`], filename, {
    type: 'application/json',
  });
}

export function guessContentType(path: string): string {
  const p = path.toLowerCase().split('?')[0]!;
  if (p.endsWith('.json')) return CT_JSON;
  if (p.endsWith('.html') || p.endsWith('.htm')) return CT_HTML;
  if (p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.cjs')) return CT_JS;
  if (p.endsWith('.css')) return CT_CSS;
  if (p.endsWith('.svg')) return CT_SVG;
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
  if (p.endsWith('.webp')) return 'image/webp';
  if (p.endsWith('.gif')) return 'image/gif';
  if (p.endsWith('.ico')) return 'image/x-icon';
  if (p.endsWith('.woff2')) return 'font/woff2';
  if (p.endsWith('.woff')) return 'font/woff';
  if (p.endsWith('.md') || p.endsWith('.markdown')) return 'text/markdown; charset=utf-8';
  if (p.endsWith('.txt') || p.endsWith('.log')) return CT_TEXT;
  if (p.endsWith('.tgz') || p.endsWith('.tar.gz') || p.endsWith('.gz')) return CT_GZIP;
  if (p.endsWith('.wasm')) return 'application/wasm';
  if (p.endsWith('.map')) return CT_JSON;
  if (p.endsWith('.xml')) return 'application/xml; charset=utf-8';
  return CT_OCTET;
}

export function fetchHeadersForBody(
  body: BodyInit | null | undefined,
  base?: HeadersInit
): Headers {
  const h = new Headers(base);
  if (body == null) return h;
  if (h.has('Content-Type') || h.has('content-type')) return h;
  const our = ourContentTypeForBody(body);
  if (our) h.set('Content-Type', our);
  return h;
}
