#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/networking/tcp#create-a-connection-bun-connect — Bun.connect
// @see https://bun.com/docs/runtime/hashing#bun-cryptohasher — Bun.CryptoHasher
// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file — Bun.file
// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write — Bun.write
// @see https://bun.com/docs/runtime/sqlite#load-via-es-module-import — bun:sqlite
// @see https://bun.com/docs/runtime/http/server#configuring-a-default-port — BUN_PORT / PORT / NODE_PORT
// @see https://bun.com/docs/runtime/http/server#changing-the-port-and-hostname — port + hostname
// @see https://bun.com/docs/runtime/http/routing — static paths, params, wildcards, fetch fallback
// @see https://bun.com/docs/runtime/http/routing#static-responses — zero-alloc Response routes
// @see https://bun.com/docs/runtime/http/routing#file-responses-vs-static-responses — memory vs Bun.file
// @see https://bun.com/docs/runtime/http/routing#fetch-request-handler — fetch(req, server)
// @see https://bun.com/docs/runtime/http/server#server-stop — server.stop
// @see https://bun.com/docs/runtime/utils#bun-env — Bun.env
// @see https://bun.com/docs/bundler/hot-reloading — bun --hot (server module re-eval)
// @see https://bun.com/docs/runtime/markdown#bun-markdown-html — Bun.markdown.html
// @see https://bun.com/docs/runtime/networking/fetch#content-type-handling — Content-Type
// @see https://bun.com/docs/guides/http/file-uploads#upload-files-via-http-using-formdata — FormData upload
/**
 * Local portal + static public/ server with live ops/catalog/registry APIs.
 *
 *   bun scripts/serve-public.ts
 *   bun --hot scripts/serve-public.ts      # soft reload server TS (see docs/portal-foundation.md)
 *   bun --watch scripts/serve-public.ts    # hard restart process
 *   bun run serve:public:hot               # same as --hot (flag embedded in package.json script)
 *   open http://127.0.0.1:3000/portal/ops/
 *
 * Bun flags (--hot, --watch, --port) must come immediately after `bun`, not after `run`.
 * @see https://bun.com/docs/runtime/watch-mode
 * @see https://bun.com/docs/runtime#watch
 *
 * Browser live-reload (SSE /__hmr) is ON for loopback by default.
 *   SERVE_PUBLIC_HMR=0  disable
 *   SERVE_PUBLIC_HMR=1  force on (any bind)
 *
 * Routing — Bun native recommendations (docs/runtime/http/routing):
 *   routes  — SIMD match: exact > :param > wildcard; static Response for /ready
 *             hot JSON via respondStatic (ETag); portal pages via respondAuto/file
 *   fetch   — unmatched only (publish, npm PUT, multi-segment static, 404)
 *             signature fetch(req, server) for requestIP / timeout on real sockets
 *
 * Paths:
 *   /api/operations/summary   → live SQLite
 *   /api/catalog              → account catalog from SQLite
 *   /api/registry             → full registry index
 *   /api/registry/{name}      → package detail
 *   /api/registry/{name}/versions → list/publish versions
 *   /api/registry/search      → search packages
 *   /api/dod                  → DOD submissions
 *   /api/monitoring           → live registry + ops metrics (JSON)
 *   /monitoring               → Bun.inspect.table dashboard (HTML)
 *   /api/channels/events      → notification events
 *   PUT /{name}               → npm-compatible publish (bun publish)
 *   /*                        → public/* static files
 */
import type { BunRequest } from 'bun';
import { Database } from 'bun:sqlite';
import { openOperationsDb, DEFAULT_OPS_DB_PATH } from '../lib/operations/db.ts';
import { buildOpsSummary } from '../lib/operations/ops-summary.ts';
import { collectMonitoring, renderMonitoringHtml } from '../lib/monitoring/index.ts';
import { DODVerifier } from '../lib/dod/verifier.ts';
import {
  bearerToken,
  configuredPublishToken,
  decidePublishAuth,
} from '../lib/registry/publish-auth.ts';
import { envCheckForHealth } from '../lib/env-check.ts';
import {
  computeDataETag,
  isFresh,
  notModified,
  respondWithSharedETag,
} from '../lib/http/data-etag.ts';
import {
  parseNetworkingProofArtifact,
  toMonitoringNetworkingReport,
  NETWORKING_REPORT_TYPES,
  NETWORKING_PROOF_SCHEMA_VERSION,
} from '../lib/http/networking-proof.ts';
import {
  getRouteStats,
  preloadStaticMap,
  respondAuto,
  respondStatic,
  type PreloadedStatic,
} from '../lib/http/static-response.ts';
import {
  LiveReloadHub,
  maybeInjectLiveReloadResponse,
  shouldEnableLiveReload,
} from '../lib/http/live-reload.ts';
import { formString, requireFormBlob, sha256Blob, writeFormBlob } from '../lib/http/form-upload.ts';
import {
  contentTypePolicyTableRows,
  summarizeContentTypeMatrix,
} from '../lib/http/content-type.ts';
import { buildPortalEnvStatus } from '../lib/http/portal-env-status.ts';
import { parsePortalMdPath } from '../lib/http/portal-nav.ts';
import {
  portalMarkdownExists,
  portalMarkdownRaw,
  renderPortalMarkdownPage,
} from '../lib/http/portal-markdown.ts';
import { llmsFullTxtBody, llmsTxtBody, PORTAL_MD_SLUGS } from '../lib/http/llms-txt.ts';
import { buildSkillsCatalog } from '../lib/http/skills-catalog.ts';
import {
  serveVerificationScript,
  serveVerificationScriptMeta,
} from '../lib/http/verification-scripts.ts';
import { resolvePublishReadme } from '../lib/registry/npm-publish-readme.ts';
import {
  serveBindSnapshot,
  type BunServer,
  type BunServeOptions,
  type ServeBindSnapshot,
} from '../lib/http/bun-server.ts';
import { resolveBunServeDefaultPort } from '../lib/http/bun-serve-shape.ts';
import { getDb, getMonitoringData } from '../lib/db/connection.ts';

/** Optional bind override — omit to use Bun docs default (`0.0.0.0`). */
const HOST_OVERRIDE = (Bun.env.HOST || Bun.env.BIND_HOST)?.trim() || undefined;
/** Hint for live-reload gating before listen (runtime uses `localhost` when hostname omitted). */
const BIND_HOST_HINT = HOST_OVERRIDE ?? 'localhost';
const dbPath = Bun.env.OPS_DB_PATH || DEFAULT_OPS_DB_PATH;
/** Browser SSE live-reload (not Cloudflare Pages). */
const LIVE_RELOAD = shouldEnableLiveReload({ host: BIND_HOST_HINT });
/**
 * Bun.serve development flag — docs default true; we prefer false for prod-like
 * local/staging unless SERVE_PUBLIC_DEV=1 or NODE_ENV=development.
 */
const SERVE_DEVELOPMENT =
  Bun.env.SERVE_PUBLIC_DEV === '1' ||
  Bun.env.NODE_ENV === 'development' ||
  Bun.env.NODE_ENV === 'dev';

/** Active server for graceful stop (Bun Server interface). */
let activeServer: BunServer | null = null;

function json(
  data: object | string | number | boolean | null,
  status = 200,
  cache = 'no-store'
): Response {
  return Response.json(data, {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache },
  });
}

/** Fail-closed publish gate — 503 unconfigured, 401 bad/missing Bearer. */
async function requirePublishAuth(req: Request): Promise<Response | null> {
  const decision = await decidePublishAuth(req);
  if (decision.ok) return null;
  return json(
    decision.hint ? { error: decision.error, hint: decision.hint } : { error: decision.error },
    decision.status
  );
}

async function writeBytes(path: string, data: Uint8Array | string): Promise<void> {
  // Bun.write creates parent directories
  await Bun.write(path, data);
}

// ── Ops Summary ─────────────────────────────────────────────────────

async function liveOpsSummary(): Promise<Response> {
  try {
    return json(buildOpsSummary(getDb(), 'live'));
  } catch (err) {
    const snap = Bun.file('public/registry/ops-summary.json');
    if (await snap.exists()) {
      const data = (await snap.json()) as Record<string, unknown>;
      return json({ ...data, source: 'snapshot', fallback: 'db-unavailable' });
    }
    return json(
      {
        error: 'Failed to open operations DB',
        detail: err instanceof Error ? err.message : String(err),
        source: 'none',
      },
      503
    );
  }
}

// ── Account Catalog ─────────────────────────────────────────────────

async function liveCatalog(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const search = url.searchParams.get('search') || '';
  const category = url.searchParams.get('category') || '';
  const status = url.searchParams.get('status') || '';
  try {
    const db = getDb();
    let sql = `SELECT p.id as platform_id, p.name as platform, p.category, p.sub_category, a.id as account_id, a.partner_id, a.account_identifier, a.balance, a.status, a.notes, a.opened_at, a.last_verified_at, n.name as partner_name, n.type as partner_type FROM partner_platform_accounts a JOIN platforms p ON a.platform_id = p.id JOIN tree_nodes n ON a.partner_id = n.id WHERE a.status != 'closed'`;
    const params: (string | number)[] = [];
    if (search) {
      sql += ' AND (p.name LIKE ? OR a.account_identifier LIKE ? OR n.name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (category) {
      sql += ' AND p.category = ?';
      params.push(category);
    }
    if (status) {
      sql += ' AND a.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY p.category, p.name';
    return json({ source: 'live', accounts: db.query(sql).all(...params) });
  } catch {
    const file = Bun.file('public/registry/catalog-snapshot.json');
    if (await file.exists()) return json(await file.json());
    return json(
      { error: 'No live database or snapshot available', source: 'none', accounts: [] },
      503
    );
  }
}

// ── Registry Index ──────────────────────────────────────────────────

async function readRegistry() {
  const f = Bun.file('public/registry/registry.json');
  if (!(await f.exists())) return null;
  return JSON.parse(await f.text());
}

async function serveRegistryIndex(): Promise<Response> {
  const reg = await readRegistry();
  if (!reg) return json({ error: 'No registry index' }, 404);
  return json(reg);
}

/** GET /api/registry/static — aggregated snapshot with monitoring + proof. */
async function serveStaticRegistry(): Promise<Response> {
  const f = Bun.file('public/registry/static.json');
  if (await f.exists())
    return new Response(f, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
      },
    });
  // Fallback to live aggregation
  const reg = await readRegistry();
  const db = openOperationsDb({ path: dbPath });
  let ops: Record<string, unknown> = {};
  try {
    ops = buildOpsSummary(db, 'live') as Record<string, unknown>;
  } catch {}
  db.close();
  const proofFile = Bun.file('tools/bun-api-coverage-proof.json');
  let proof: Record<string, unknown> = {};
  if (await proofFile.exists())
    try {
      proof = JSON.parse(await proofFile.text());
    } catch {}
  const snapshot = {
    generated: new Date().toISOString(),
    bunVersion: Bun.version,
    packageCount: reg?.packages ? Object.keys(reg.packages).length : 0,
    packages: reg?.packages || {},
    ops,
    bunApiProof: proof,
  };
  return new Response(JSON.stringify(snapshot, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function searchRegistry(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.toLowerCase() || '';
  const type = url.searchParams.get('type')?.toLowerCase() || '';
  const reg = await readRegistry();
  if (!reg) return json({ results: [] });
  const results: { name: string; version: string; type: string; description: string }[] = [];
  for (const [name, pkg] of Object.entries(reg.packages || {})) {
    const info = pkg as any;
    const latest = info['dist-tags']?.latest;
    const rel = latest ? info.releases?.[latest] : null;
    if (
      q &&
      !name.toLowerCase().includes(q) &&
      !(rel?.description || '').toLowerCase().includes(q) &&
      !(rel?.tags || []).some((t: string) => t.toLowerCase().includes(q))
    )
      continue;
    if (type && rel?.type !== type) continue;
    results.push({
      name,
      version: latest || '?',
      type: rel?.type || '?',
      description: rel?.description || '',
    });
  }
  return json({ results, total: results.length });
}

async function packageDetail(name: string): Promise<Response> {
  const reg = await readRegistry();
  if (!reg) return json({ error: 'No registry' }, 404);
  const pkg = (reg.packages || {})[name];
  if (!pkg) return json({ error: 'Package not found' }, 404);
  return json({ name, ...pkg });
}

// ── Version endpoints ───────────────────────────────────────────────

async function listVersions(name: string): Promise<Response> {
  const reg = await readRegistry();
  const pkg = reg?.packages?.[name];
  if (!pkg) return json({ versions: [] });
  return json({
    name,
    versions: (pkg.versions || []).map((v: string) => {
      const r = pkg.releases?.[v];
      return {
        version: v,
        publishedAt: r?.publishedAt || null,
        checksum: r?.storage?.checksum || null,
        type: r?.type || null,
        description: r?.description || null,
      };
    }),
    distTags: pkg['dist-tags'] || {},
  });
}

async function publishVersion(req: Request, name: string): Promise<Response> {
  const authErr = await requirePublishAuth(req);
  if (authErr) return authErr;
  // Bun guide: await req.formData() → get fields → Bun.write(path, blob)
  const form = await req.formData();
  const filePart = requireFormBlob(form, 'file');
  if (!filePart.ok) return json({ error: filePart.error }, 400);
  const version = formString(form, 'version');
  if (!version) return json({ error: 'Version required' }, 400);
  const tags = (formString(form, 'tags') || '')
    .split(',')
    .map((t: string) => t.trim())
    .filter(Boolean);
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(formString(form, 'metadata') || '{}');
  } catch {
    /* empty metadata */
  }
  const { blob } = filePart;
  const sha256 = await sha256Blob(blob);
  const size = blob.size;
  const storageDir = `public/registry/storage/${name}/${version}`;
  // Bun.write accepts Blob/File directly (no Buffer.copy)
  await writeFormBlob(`${storageDir}/artifact.tgz`, blob);
  const raw = await Bun.file('public/registry/registry.json').text();
  const reg = JSON.parse(raw || '{"packages":{}}');
  if (!reg.packages) reg.packages = {};
  if (!reg.packages[name]) reg.packages[name] = { versions: [], 'dist-tags': {}, releases: {} };
  const pkg = reg.packages[name];
  if (!pkg.versions.includes(version)) pkg.versions.push(version);
  pkg.versions.sort((a: string, b: string) => a.localeCompare(b, undefined, { numeric: true }));
  for (const tag of tags) pkg['dist-tags'][tag] = version;
  pkg.releases[version] = {
    id: `${name}@${version}`,
    name,
    version,
    type: metadata.type || 'library',
    description: metadata.description || '',
    tags: metadata.tags || tags,
    publishedAt: new Date().toISOString(),
    publisher: 'api',
    storage: {
      r2Key: `@factorywager/${name}/${version}.tgz`,
      size,
      checksum: sha256,
      contentType: blob.type || 'application/gzip',
    },
  };
  await Bun.write('public/registry/registry.json', `${JSON.stringify(reg, null, 2)}\n`);
  return json({ success: true, version, checksum: sha256, size });
}

// ── npm-compatible publish (bun publish) ────────────────────────────

async function npmPublish(req: Request, name: string): Promise<Response> {
  const authErr = await requirePublishAuth(req);
  if (authErr) return authErr;
  const ct = req.headers.get('content-type') || '';
  let version = '';
  let tarballBuf: Uint8Array | null = null;
  let publishBody: Record<string, unknown> | null = null;
  if (ct.includes('application/json')) {
    publishBody = (await req.json()) as Record<string, unknown>;
    version =
      publishBody['dist-tags']?.latest || Object.keys(publishBody.versions || {})[0] || '0.0.0';
    const attachments = publishBody._attachments as Record<string, { data?: string }> | undefined;
    if (attachments) {
      const data = attachments[Object.keys(attachments)[0]!]?.data;
      if (data) tarballBuf = Buffer.from(data, 'base64');
    }
  } else {
    tarballBuf = new Uint8Array(await req.arrayBuffer());
    version = `0.0.0-${Date.now()}`;
  }
  if (!tarballBuf) return json({ error: 'No tarball in request' }, 400);
  const manifest = await resolvePublishReadme(publishBody, version, tarballBuf);
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', tarballBuf)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const storageDir = `public/registry/storage/${name}/${version}`;
  await writeBytes(`${storageDir}/artifact.tgz`, tarballBuf);
  const raw = await Bun.file('public/registry/registry.json').text();
  const reg = JSON.parse(raw || '{"packages":{}}');
  if (!reg.packages) reg.packages = {};
  if (!reg.packages[name]) reg.packages[name] = { versions: [], 'dist-tags': {}, releases: {} };
  const pkg = reg.packages[name];
  if (!pkg.versions.includes(version)) pkg.versions.push(version);
  pkg.versions.sort((a: string, b: string) => a.localeCompare(b, undefined, { numeric: true }));
  pkg['dist-tags'].latest = version;
  pkg.releases[version] = {
    id: `${name}@${version}`,
    name,
    version,
    type: 'library',
    description: manifest.description ?? 'Published via bun publish',
    ...(manifest.dependencies ? { dependencies: manifest.dependencies } : {}),
    ...(manifest.readme
      ? { readme: manifest.readme, readmeFilename: manifest.readmeFilename ?? 'README.md' }
      : {}),
    publishedAt: new Date().toISOString(),
    publisher: 'bun-publish',
    storage: {
      r2Key: `@factorywager/${name}/${version}.tgz`,
      size: tarballBuf.length,
      checksum: sha256,
      contentType: 'application/gzip',
    },
  };
  await writeBytes('public/registry/registry.json', JSON.stringify(reg, null, 2));
  return json({ ok: true, id: `${name}@${version}`, revision: sha256.slice(0, 12) });
}

// ── npm-compatible package metadata (for bun install / bunx) ────────

async function npmPackageMetadata(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const rawPath = url.pathname;
  // Handle URL-encoded scoped names: /@factorywager%2Fregistry-client → @factorywager/registry-client
  const name = decodeURIComponent(rawPath.startsWith('/@') ? rawPath.slice(1) : rawPath.slice(1));
  if (!name) {
    return staticFile('/index.html', req).then(
      r =>
        r ??
        new Response('Not found', {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
    );
  }
  const reg = await readRegistry();
  if (!reg) return json({ error: 'No registry' }, 404);
  const pkg = (reg.packages || {})[name];
  if (!pkg) return json({ error: 'Package not found' }, 404);

  // Build npm-registry-compatible response
  const latest = pkg['dist-tags']?.latest;
  const versions: Record<string, any> = {};
  for (const v of pkg.versions || []) {
    const rel = pkg.releases?.[v];
    if (!rel) continue;
    versions[v] = {
      name,
      version: v,
      type: rel.type,
      description: rel.description,
      bin: rel.bin || undefined,
      dependencies: rel.dependencies || undefined,
      readme: rel.readme || undefined,
      readmeFilename: rel.readmeFilename || (rel.readme ? 'README.md' : undefined),
      dist: {
        tarball: `${url.origin}/registry/storage/${name.split('/').map(encodeURIComponent).join('/')}/${v}/artifact.tgz`,
        // npm SRI: sha256-<base64 of the 32 digest bytes> (hex string mislabeled
        // as SRI breaks install-time integrity verification).
        shasum: rel.storage?.checksum?.slice(0, 40) || '',
        integrity: rel.storage?.checksum
          ? `sha256-${Buffer.from(rel.storage.checksum, 'hex').toString('base64')}`
          : undefined,
        size: rel.storage?.size || 0,
      },
    };
  }

  return json({
    _id: name,
    name,
    'dist-tags': pkg['dist-tags'] || {},
    versions,
    time: Object.fromEntries(
      (pkg.versions || []).map((v: string) => {
        const rel = pkg.releases?.[v];
        return [v, rel?.publishedAt || new Date().toISOString()];
      })
    ),
  });
}

// ── DOD / Channels ──────────────────────────────────────────────────

const dodVerifier = new DODVerifier();

async function dodApi(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace('/api/dod', '').replace(/\/$/, '');

  if (req.method === 'GET') {
    const status = url.searchParams.get('status') || 'all';
    return json(dodVerifier.list(status));
  }

  if (req.method === 'POST') {
    const body = await req.json();
    if (path === '/approve' && body.id) {
      dodVerifier.approve(body.id);
      return json({ ok: true, id: body.id, status: 'verified' });
    }
    if (path === '/reject' && body.id) {
      dodVerifier.reject(body.id, body.reason || 'Not specified');
      return json({ ok: true, id: body.id, status: 'rejected' });
    }
  }
  return json({ error: 'Not found' }, 404);
}

async function channelsEvents(req: Request): Promise<Response> {
  const url = new URL(req.url);
  return json({
    topic: url.searchParams.get('topic') || 'factory',
    since: parseInt(url.searchParams.get('since') || '0', 10),
    events: [],
    ok: true,
  });
}

// ── Static files ────────────────────────────────────────────────────
// Hot small registry JSON → memory static-route (ETag); everything else → Bun.file
// @see lib/http/static-response.ts

const HOT_STATIC_PATHS = [
  'public/registry/ops-summary.json',
  'public/registry/static.json',
  'public/registry/monitoring.json',
  'public/registry/registry.json',
  'public/registry/@factorywager/bun-utils-test/latest.json',
  'public/registry/@factorywager/routing-test/latest.json',
  'public/registry/@factorywager/registry-snapshot/latest.json',
  'public/registry/@factorywager/proof-packages.json',
  'public/registry/prediction/report.html',
  'public/registry/prediction/coverage-chart.svg',
  'public/registry/prediction/error-chart.svg',
  'public/registry/networking-proof.json',
  'public/registry/install-env-proof.json',
  'public/registry/registry-client-proof.json',
  'public/registry/docs-coverage-proof.json',
  'public/registry/bun-runtime-nits-proof.json',
  'public/registry/doc-index.json',
  'tools/bun-api-coverage-proof.json',
];

/** Paths polled for browser live-reload (mtime via Bun.file). */
const WATCH_PATHS = [
  ...HOT_STATIC_PATHS,
  'public/portal/index.html',
  'public/portal/ops/index.html',
  'public/portal/skills/index.html',
  'public/portal/operations-dashboard.js',
  'public/portal/app.js',
  'public/portal/style.css',
  'public/monitoring/index.html',
];

const hotByUrl = new Map<string, PreloadedStatic>();
const fileRouteCache = new Map<string, PreloadedStatic>();

function rebuildHotUrlMap(hotStatic: Map<string, PreloadedStatic>): void {
  hotByUrl.clear();
  for (const [fsPath, asset] of hotStatic) {
    hotByUrl.set('/' + fsPath.replace(/^public\//, ''), asset);
  }
  const proofAsset = hotStatic.get('tools/bun-api-coverage-proof.json');
  if (proofAsset) {
    hotByUrl.set('/api/proof', proofAsset);
    hotByUrl.set('/api/proof/', proofAsset);
  }
}

async function refreshHotStatic(reason = 'reload'): Promise<void> {
  const hotStatic = await preloadStaticMap(HOT_STATIC_PATHS, { optional: true });
  rebuildHotUrlMap(hotStatic);
  fileRouteCache.clear();
  if (LIVE_RELOAD) {
    // reason is for logs; browser notify is driven by watcher
    void reason;
  }
}

// Initial preload
{
  const hotStatic = await preloadStaticMap(HOT_STATIC_PATHS, { optional: true });
  rebuildHotUrlMap(hotStatic);
}

const liveReloadHub = LIVE_RELOAD
  ? new LiveReloadHub({
      pollMs: 350,
      onChange: async path => {
        console.log(`[hmr] change ${path} — refresh preload cache`);
        await refreshHotStatic(path);
      },
    })
  : null;

async function withLiveReload(res: Response): Promise<Response> {
  return maybeInjectLiveReloadResponse(res, LIVE_RELOAD);
}

/** GET /registry/storage/{name}/{version}/artifact.tgz — decode scoped segments for disk lookup. */
async function serveRegistryStorage(pathname: string, request: Request): Promise<Response | null> {
  const prefix = '/registry/storage/';
  if (!pathname.startsWith(prefix) || !pathname.endsWith('/artifact.tgz')) return null;
  const rel = pathname.slice(prefix.length);
  const segments = rel.split('/').map(segment => decodeURIComponent(segment));
  if (segments.length < 3) return null;
  const fsPath = `public/registry/storage/${segments.join('/')}`;
  const file = Bun.file(fsPath);
  if (!(await file.exists())) return null;
  return respondAuto(fsPath, request, {
    cache: fileRouteCache,
    cacheControl: 'public, max-age=60',
  });
}

async function staticFile(
  pathname: string,
  request: Request = new Request('http://local/')
): Promise<Response | null> {
  let path = pathname === '/' ? '/index.html' : pathname;
  if (path.endsWith('/')) path = `${path}index.html`;

  const hot = hotByUrl.get(path);
  if (hot) {
    // Dev: no-store so browser picks up post-reload content
    const cache = LIVE_RELOAD ? 'no-store' : 'public, max-age=30';
    return withLiveReload(respondStatic(hot, request, { cacheControl: cache }));
  }

  let fsPath = `public${path}`;
  let file = Bun.file(fsPath);
  if (!(await file.exists()) && !path.endsWith('.html') && !path.includes('.')) {
    fsPath = `public${path}/index.html`;
    file = Bun.file(fsPath);
    path = `${path}index.html`.replace(/\/+/g, '/');
  }
  if (!(await file.exists())) return null;

  const cacheControl = LIVE_RELOAD
    ? 'no-store'
    : path.startsWith('/registry/')
      ? 'public, max-age=60'
      : 'public, max-age=300';
  // Skip memory cache for HTML when live-reload so disk is always fresh
  const res = await respondAuto(fsPath, request, {
    cache: path.endsWith('.html') && LIVE_RELOAD ? undefined : fileRouteCache,
    cacheControl,
  });
  return withLiveReload(withMarkdownAlternate(res, path));
}

/**
 * Advertise the machine-readable markdown alternate on portal HTML pages:
 *   Link: </portal/{slug}.md>; rel="alternate"; type="text/markdown"
 */
function withMarkdownAlternate(res: Response, path: string): Response {
  if (!path.endsWith('.html')) return res;
  let slug: string | null = null;
  if (path === '/portal/index.html') slug = 'index';
  else {
    const m = path.match(/^\/portal\/(ops|catalog|dod|health|env|monitoring|skills)\/index\.html$/);
    if (m) slug = m[1]!;
  }
  if (!slug) return res;
  const headers = new Headers(res.headers);
  headers.append('Link', `</portal/${slug}.md>; rel="alternate"; type="text/markdown"`);
  return new Response(res.body, { status: res.status, headers });
}

// ── Server ──────────────────────────────────────────────────────────

const startedAt = Date.now();

/** GET /api/monitoring — registry + ops metrics + API proof (JSON). */
async function liveMonitoringApi(): Promise<Response> {
  try {
    const data = (await getMonitoringData({ source: 'live', uptimeOriginMs: startedAt })) as Record<
      string,
      unknown
    >;
    // Append Bun API proof status
    const proofFile = Bun.file('tools/bun-api-coverage-proof.json');
    if (await proofFile.exists()) {
      const proof = JSON.parse(await proofFile.text());
      data.bunApiProof = {
        generated: proof.generated,
        bunVersion: proof.bunVersion,
        demosTotal: proof.summary?.demos ?? 0,
        demosPassed: proof.summary?.demosPassed ?? 0,
        apisTotal: proof.summary?.apis ?? 0,
        apisVerified: proof.summary?.apisVerified ?? 0,
        allPassed: proof.summary?.demosPassed === proof.summary?.demos,
      };
    }
    data.routeStats = routeStatsForHealth();
    data.env = envCheckForHealth();
    // Append networking proof
    const netFile = Bun.file('public/registry/networking-proof.json');
    if (await netFile.exists()) {
      try {
        const parsed = parseNetworkingProofArtifact(await netFile.json());
        data.networkingProof = parsed ? toMonitoringNetworkingReport(parsed) : await netFile.json();
      } catch {}
    }
    // Append install env proof
    const envFile = Bun.file('public/registry/install-env-proof.json');
    if (await envFile.exists()) {
      try {
        data.installEnvProof = JSON.parse(await envFile.text());
      } catch {}
    }
    const rcFile = Bun.file('public/registry/registry-client-proof.json');
    if (await rcFile.exists()) {
      try {
        data.registryClientProof = JSON.parse(await rcFile.text());
      } catch {}
    }
    const nitsFile = Bun.file('public/registry/bun-runtime-nits-proof.json');
    if (await nitsFile.exists()) {
      try {
        data.bunRuntimeNitsProof = JSON.parse(await nitsFile.text());
      } catch {}
    }
    const docsCovFile = Bun.file('public/registry/docs-coverage-proof.json');
    if (await docsCovFile.exists()) {
      try {
        data.docsCoverageProof = JSON.parse(await docsCovFile.text());
      } catch {}
    }
    return json(data);
  } catch (err) {
    const snap = Bun.file('public/registry/monitoring.json');
    if (await snap.exists()) {
      const data = (await snap.json()) as Record<string, unknown>;
      // Append proof files to snapshot fallback too
      const proofFiles = [
        ['bunApiProof', 'tools/bun-api-coverage-proof.json'],
        ['networkingProof', 'public/registry/networking-proof.json'],
        ['installEnvProof', 'public/registry/install-env-proof.json'],
        ['registryClientProof', 'public/registry/registry-client-proof.json'],
        ['docsCoverageProof', 'public/registry/docs-coverage-proof.json'],
        ['bunRuntimeNitsProof', 'public/registry/bun-runtime-nits-proof.json'],
        ['defaultsProof', 'public/registry/defaults-proof.json'],
      ];
      for (const [key, path] of proofFiles) {
        try {
          const f = Bun.file(path);
          if (await f.exists()) data[key] = JSON.parse(await f.text());
        } catch {}
      }
      return json({
        ...data,
        source: 'snapshot',
        fallback: 'db-unavailable',
        routeStats: routeStatsForHealth(),
      });
    }
    return json(
      {
        error: 'Failed to collect monitoring metrics',
        detail: err instanceof Error ? err.message : String(err),
        source: 'none',
      },
      503
    );
  }
}

/** GET /monitoring — server-rendered Bun.inspect.table dashboard. */
async function monitoringPage(): Promise<Response> {
  try {
    const data = await getMonitoringData({ source: 'live', uptimeOriginMs: startedAt });
    return withLiveReload(
      new Response(renderMonitoringHtml(data), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    );
  } catch {
    const staticRes = await staticFile('/monitoring/', new Request('http://local/monitoring/'));
    if (staticRes) return staticRes;
    return new Response('Monitoring unavailable', { status: 503 });
  }
}

/** Health data TTL — regenerate underlying payload every 5s; ETag is data-scoped. */
const HEALTH_TTL_MS = 5_000;
let healthDataCache: { data: Record<string, unknown>; etag: string; at: number } | null = null;

function routeStatsForHealth() {
  return getRouteStats([hotByUrl, fileRouteCache]);
}

/**
 * Fields that change every second must not enter the shared data ETag
 * (uptime, hit counters) — otherwise JSON and /health/pre never share a 304.
 */
function healthETagPayload(data: Record<string, unknown>): Record<string, unknown> {
  const { uptimeSeconds: _u, routeStats, ...rest } = data;
  const rs = routeStats as Record<string, unknown> | undefined;
  return {
    ...rest,
    routeStats: rs
      ? {
          staticRoutes: rs.staticRoutes,
          fileRoutes: rs.fileRoutes,
          totalMemoryUsed: rs.totalMemoryUsed,
          decision: rs.decision,
        }
      : undefined,
  };
}

async function readNetworkingProofCompact(): Promise<Record<string, unknown>> {
  const f = Bun.file('public/registry/networking-proof.json');
  if (!(await f.exists())) return { available: false };
  try {
    const raw = await f.json();
    const parsed = parseNetworkingProofArtifact(raw);
    if (parsed) {
      const checksPassed = parsed.global.checksPassed;
      const checksTotal = parsed.global.checksTotal;
      return {
        available: true,
        reportType: parsed.reportType,
        schemaVersion: parsed.schemaVersion,
        generated: parsed.timestamp,
        proofHash: parsed.proofHash,
        checksPassed,
        checksTotal,
        targets: parsed.targets.length,
        allOk: parsed.allOk,
        degraded: !parsed.allOk,
      };
    }
    const p = raw as {
      proofHash?: string;
      timestamp?: string;
      global?: { checksPassed?: number; checksTotal?: number };
      targets?: unknown[];
    };
    const checksPassed = p.global?.checksPassed ?? 0;
    const checksTotal = p.global?.checksTotal ?? 0;
    return {
      available: true,
      reportType: NETWORKING_REPORT_TYPES.verification,
      schemaVersion: null,
      generated: p.timestamp ?? null,
      proofHash: p.proofHash ?? null,
      checksPassed,
      checksTotal,
      targets: Array.isArray(p.targets) ? p.targets.length : 0,
      allOk: checksTotal > 0 && checksPassed >= checksTotal,
      degraded: checksTotal > 0 && checksPassed < checksTotal,
      legacy: true,
    };
  } catch {
    return { available: false };
  }
}

async function collectHealthData(): Promise<{
  data: Record<string, unknown>;
  etag: string;
}> {
  const now = Date.now();
  if (healthDataCache && now - healthDataCache.at < HEALTH_TTL_MS) {
    return { data: healthDataCache.data, etag: healthDataCache.etag };
  }

  const summary = Bun.file('public/registry/ops-summary.json');
  const exists = await summary.exists();
  let generated: string | null = null;
  let ageSeconds: number | null = null;
  if (exists) {
    try {
      const parsed = (await summary.json()) as { generated?: string };
      generated = parsed.generated ?? null;
      ageSeconds = generated ? Math.round((Date.now() - Date.parse(generated)) / 1000) : null;
    } catch {
      /* malformed artifact still reports exists */
    }
  }

  const reg = await readRegistry();
  const pkgCount = reg?.packages ? Object.keys(reg.packages).length : 0;
  const versionCount = reg?.packages
    ? Object.values(reg.packages).reduce(
        (sum: number, p: any) => sum + (p.versions?.length || 0),
        0
      )
    : 0;

  const proofFile = Bun.file('tools/bun-api-coverage-proof.json');
  let proofStatus: Record<string, unknown> = { available: false };
  if (await proofFile.exists()) {
    try {
      const proof = JSON.parse(await proofFile.text());
      proofStatus = {
        available: true,
        generated: proof.generated,
        demosPassed: proof.summary?.demosPassed,
        demosTotal: proof.summary?.demos,
        apisVerified: proof.summary?.apisVerified,
      };
    } catch {
      /* ignore */
    }
  }

  const routeStats = routeStatsForHealth();
  const envCheck = envCheckForHealth();
  const networking = await readNetworkingProofCompact();
  const ctMatrix = summarizeContentTypeMatrix();
  const docIndexFile = Bun.file('public/registry/doc-index.json');
  let docRefs: Record<string, unknown> = { available: false };
  if (await docIndexFile.exists()) {
    try {
      const parsed = (await docIndexFile.json()) as {
        totalEntries?: number;
        byStability?: Record<string, number>;
        defaultsCoverage?: { passed?: boolean };
        proofHash?: string;
        timestamp?: string;
      };
      docRefs = {
        available: true,
        totalEntries: parsed.totalEntries ?? 0,
        stable: parsed.byStability?.stable ?? 0,
        experimental: parsed.byStability?.experimental ?? 0,
        deprecated: parsed.byStability?.deprecated ?? 0,
        defaultsCoverage: parsed.defaultsCoverage?.passed ?? false,
        proofHash: parsed.proofHash,
        generated: parsed.timestamp,
      };
    } catch {
      docRefs = { available: true, malformed: true };
    }
  }
  const networkingDegraded =
    networking.available === true &&
    typeof networking.degraded === 'boolean' &&
    networking.degraded;
  const data: Record<string, unknown> = {
    schemaVersion: 1,
    status: envCheck.summary.requiredMissing > 0 || networkingDegraded ? 'degraded' : 'ok',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    bun: Bun.version,
    platform: process.arch + ' ' + process.platform,
    artifacts: { opsSummary: { exists, generated, ageSeconds } },
    registry: { packages: pkgCount, versions: versionCount },
    bunApiProof: proofStatus,
    networking,
    routeStats,
    env: envCheck,
    /** Content-Type: defaultValue | ourValue | wireValue | expected | status */
    contentType: {
      total: ctMatrix.total,
      pass: ctMatrix.pass,
      warn: ctMatrix.warn,
      fail: ctMatrix.fail,
      byStatus: ctMatrix.byStatus,
      /** compact rows for dashboards */
      rows: contentTypePolicyTableRows(ctMatrix.rows).map(r => ({
        id: r.id,
        side: r.side,
        defaultValue: r.defaultValue,
        ourValue: r.ourValue,
        wireValue: r.wireValue,
        expected: r.expected,
        status: r.status,
        severity: r.severity,
      })),
    },
    docRefs,
    serve: {
      strategies: {
        static: 'memory + ETag + If-None-Match (hot registry JSON, health)',
        file: 'Bun.file stream + Last-Modified + Range (large / changing)',
        hybrid: '≤512KiB first hit → static cache; else file',
      },
      etagScope: 'shared-data across /health and /health/pre (Vary: Accept)',
      hotPreloaded: [...hotByUrl.keys()],
    },
  };

  const etag = computeDataETag(healthETagPayload(data));
  healthDataCache = { data, etag, at: now };
  return { data, etag };
}

function renderHealthPlain(data: Record<string, unknown>): string {
  const lines: string[] = [
    '╔══════════════════════════════════════════╗',
    '║     FactoryWager · Health Diagnostics    ║',
    '╚══════════════════════════════════════════╝',
    '',
    `  Status:    ${data.status}`,
    `  Uptime:    ${formatDuration(data.uptimeSeconds as number)}`,
    `  Runtime:   Bun ${data.bun} (${data.platform})`,
    `  PID:       ${process.pid}`,
    `  Started:   ${new Date(startedAt).toISOString()}`,
    '',
    '── Registry ──────────────────────────────',
    `  Packages:  ${(data.registry as Record<string, number>)?.packages ?? '?'}`,
    `  Versions:  ${(data.registry as Record<string, number>)?.versions ?? '?'}`,
    '',
    '── Artifacts ─────────────────────────────',
    `  Ops summary: ${((data.artifacts as Record<string, unknown>)?.opsSummary as Record<string, unknown>)?.exists ? 'yes' : 'no'}`,
    `  Generated:   ${((data.artifacts as Record<string, unknown>)?.opsSummary as Record<string, unknown>)?.generated ?? '—'}`,
    '',
    '── Bun API Proof ────────────────────────',
  ];
  const proof = (data.bunApiProof as Record<string, unknown>) || {};
  if (proof.available) {
    lines.push(`  Generated:   ${proof.generated}`);
    lines.push(`  Demos:       ${proof.demosPassed}/${proof.demosTotal} passed`);
    lines.push(`  APIs:        ${proof.apisVerified} verified`);
  } else {
    lines.push('  Not generated — run bun run docs:api-verify --write');
  }
  const net = (data.networking as Record<string, unknown>) || {};
  lines.push('', '── Networking Proof ───────────────────────');
  if (net.available) {
    lines.push(`  Report type: ${net.reportType ?? NETWORKING_REPORT_TYPES.verification}`);
    lines.push(`  Schema:      ${net.schemaVersion ?? NETWORKING_PROOF_SCHEMA_VERSION}`);
    lines.push(`  Generated:   ${net.generated ?? '—'}`);
    lines.push(`  Checks:      ${net.checksPassed}/${net.checksTotal} passed`);
    lines.push(`  Targets:     ${net.targets ?? '—'}`);
    lines.push(`  Proof hash:  ${String(net.proofHash ?? '—').slice(0, 16)}…`);
  } else {
    lines.push('  Not generated — run bun run check:networking:save');
  }
  const rs = (data.routeStats as Record<string, unknown>) || {};
  lines.push(
    '',
    '── Route strategy ────────────────────────',
    `  Static (memory): ${rs.staticRoutes ?? 0} · hits ${rs.staticHits ?? 0}`,
    `  File (stream):   ${rs.fileRoutes ?? 0} · hits ${rs.fileHits ?? 0}`,
    `  304 responses:   ${rs.notModified304 ?? 0}`,
    `  Memory used:     ${Math.round(Number(rs.totalMemoryUsed ?? 0) / 1024)} KiB`,
    `  Rule:            ${((rs.decision as Record<string, string>) || {}).rule ?? '—'}`,
    `  ETag:            shared data scope (JSON + plain)`,
    ''
  );
  const ct = (data.contentType as Record<string, unknown>) || {};
  lines.push(
    '── Content-Type (default | our | wire | expected) ──',
    `  pass/warn/fail: ${ct.pass ?? 0}/${ct.warn ?? 0}/${ct.fail ?? 0} of ${ct.total ?? 0}`,
    `  byStatus:       ${JSON.stringify(ct.byStatus ?? {})}`,
    `  full matrix:    GET /api/content-type`,
    ''
  );
  const env =
    (data.env as { summary?: Record<string, number>; requiredMissingKeys?: string[] }) || {};
  if (env.summary) {
    lines.push(
      '── Environment ───────────────────────────',
      `  Checklist:    ${env.summary.ok}/${env.summary.total} ok`,
      `  Required gaps:${env.summary.requiredMissing ?? 0}`,
      `  Missing keys: ${(env.requiredMissingKeys || []).join(', ') || '—'}`,
      ''
    );
  }
  lines.push(`  Checked at: ${new Date().toISOString()}`, '');
  return lines.join('\n');
}

/**
 * Optional Server from route/fetch 2nd arg (TCP only — not server.fetch).
 * @see https://bun.com/docs/runtime/http/routing#fetch-request-handler
 */
type RouteServer = Pick<BunServer, 'requestIP' | 'timeout' | 'pendingRequests'>;

function clientSocket(req: Request, server?: RouteServer) {
  try {
    return server?.requestIP?.(req) ?? null;
  } catch {
    return null;
  }
}

/** GET /health — JSON; ETag = data hash (shared with /health/pre). */
async function health(
  req: Request = new Request('http://local/health'),
  server?: RouteServer
): Promise<Response> {
  const { data, etag } = await collectHealthData();
  // Volatile fields (uptime, client) stay out of ETag payload
  const ip = clientSocket(req, server);
  const body = {
    ...data,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    client: ip ? { address: ip.address, family: ip.family, port: ip.port } : null,
    pendingRequests: server?.pendingRequests ?? null,
  };
  return respondWithSharedETag(
    req,
    healthETagPayload(data),
    {
      body: JSON.stringify(body),
      contentType: 'application/json; charset=utf-8',
    },
    {
      etag,
      cacheControl: 'public, max-age=5, must-revalidate',
      vary: 'Accept',
      extraHeaders: {
        'X-ETag-Scope': 'health-data',
        ...(ip ? { 'X-Client-Address': ip.address } : {}),
      },
    }
  );
}

/** GET /health/pre — plain diagnostics; same data ETag as /health. */
async function healthHtml(
  req: Request = new Request('http://local/health/pre'),
  server?: RouteServer
): Promise<Response> {
  const { data, etag } = await collectHealthData();
  const ip = clientSocket(req, server);
  const live = {
    ...data,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    client: ip ? { address: ip.address, family: ip.family, port: ip.port } : null,
  };
  if (isFresh(req, etag)) {
    return notModified(etag, {
      vary: 'Accept',
      cacheControl: 'public, max-age=5, must-revalidate',
    });
  }
  return respondWithSharedETag(
    req,
    healthETagPayload(data),
    {
      body: renderHealthPlain(live),
      contentType: 'text/plain; charset=utf-8',
    },
    {
      etag,
      cacheControl: 'public, max-age=5, must-revalidate',
      vary: 'Accept',
      extraHeaders: {
        'X-ETag-Scope': 'health-data',
        ...(ip ? { 'X-Client-Address': ip.address } : {}),
      },
    }
  );
}

function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}

/** GET /api/content-type — default | our | wire | expected | status matrix. */
function contentTypeApi(): Response {
  const m = summarizeContentTypeMatrix();
  return json({
    columns: ['defaultValue', 'ourValue', 'wireValue', 'expected', 'status', 'severity'],
    summary: {
      total: m.total,
      pass: m.pass,
      warn: m.warn,
      fail: m.fail,
      byStatus: m.byStatus,
    },
    rows: contentTypePolicyTableRows(m.rows),
  });
}

/** GET /api/proof — Bun API coverage proof status. */
async function bunApiProof(): Promise<Response> {
  const proofFile = Bun.file('tools/bun-api-coverage-proof.json');
  if (!(await proofFile.exists()))
    return json({ error: 'No proof manifest generated yet — run bun run docs:api-verify' }, 404);
  const proof = JSON.parse(await proofFile.text());
  return json({
    generated: proof.generated,
    bunVersion: proof.bunVersion,
    summary: proof.summary,
    demoPassRate: proof.summary?.demos
      ? `${Math.round((proof.summary.demosPassed / proof.summary.demos) * 100)}%`
      : '0%',
    allPassed: proof.summary?.demosPassed === proof.summary?.demos,
    _links: {
      self: '/api/proof',
      // Contract note: when the proof asset is hot-preloaded this route serves
      // the raw manifest; otherwise this normalized summary. Edge /api/proof
      // (functions/api/proof.ts) is always normalized.
      manifest: '/api/proof?format=manifest',
      contract: 'normalized summary (default) | raw manifest when hot-preloaded',
    },
  });
}

/** GET /api/env — read-only env var status with HSL health indicators. */
async function envStatus(): Promise<Response> {
  return json(buildPortalEnvStatus());
}

/**
 * GET /llms.txt — machine-readable index for LLM consumers.
 * Lists the portal markdown endpoints (Accept: text/markdown) and JSON APIs.
 * @see https://llmstxt.org — llms.txt convention
 */
function llmsTxt(): Response {
  return new Response(llmsTxtBody(), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

function llmsFullTxt(): Response {
  return new Response(llmsFullTxtBody(portalMarkdownRaw), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

async function portalMarkdown(req: Request): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  const slug = parsePortalMdPath(path);
  if (!slug) return null;
  if (!portalMarkdownExists(slug)) {
    return new Response(`Not found: ${path}`, { status: 404 });
  }

  const accept = req.headers.get('accept') ?? '';
  if (accept.includes('text/markdown') && !accept.includes('text/html')) {
    const raw = portalMarkdownRaw(slug);
    return new Response(raw, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  const html = renderPortalMarkdownPage(slug);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Optional read auth — set REGISTRY_SECRET (or REGISTRY_AUTH as the bearer secret).
 * Mode keywords from .env.registry.example (`token`/`jwt`/`basic`/`none`) are ignored
 * so they are never treated as the literal password.
 */
function requireReadAuth(req: Request): Response | null {
  const modeish = new Set(['token', 'jwt', 'basic', 'none']);
  const authEnv = (Bun.env.REGISTRY_AUTH || '').trim();
  const expected =
    (Bun.env.REGISTRY_SECRET || '').trim() ||
    (authEnv && !modeish.has(authEnv.toLowerCase()) ? authEnv : '');
  if (!expected) return null;
  const provided = bearerToken(req);
  // Sync path: hash via Bun.CryptoHasher for constant-time string compare without async.
  const a = new Bun.CryptoHasher('sha256').update(provided).digest();
  const b = new Bun.CryptoHasher('sha256').update(expected).digest();
  if (a.byteLength !== b.byteLength) return json({ error: 'Unauthorized' }, 401);
  let mismatch = 0;
  for (let i = 0; i < a.byteLength; i++) mismatch |= a[i]! ^ b[i]!;
  if (mismatch !== 0) return json({ error: 'Unauthorized' }, 401);
  return null;
}

/** True when path is a single-segment npm package name (not `/`, `/index.html`, etc.). */
function isNpmPackagePath(path: string): boolean {
  if (path === '/' || path === '') return false;
  const seg = path.slice(1);
  if (!seg || seg.includes('/')) return false;
  return true;
}

/**
 * Unmatched-request handler (Bun routing docs: runs when no `routes` match).
 * Second arg is Server on real TCP; may be undefined for in-process server.fetch.
 * @see https://bun.com/docs/runtime/http/routing#fetch-request-handler
 */
async function fetchHandler(req: Request, server?: RouteServer): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // Long-lived SSE: disable idle timeout when Server is available
  if ((path === '/__hmr' || path === '/__hmr/') && server?.timeout) {
    try {
      server.timeout(req, 0);
    } catch {
      /* ignore */
    }
  }

  // Browser live-reload SSE (loopback / SERVE_PUBLIC_HMR=1)
  if (path === '/__hmr' || path === '/__hmr/') {
    if (!liveReloadHub) {
      return json({ error: 'live-reload disabled', hint: 'SERVE_PUBLIC_HMR=1' }, 404);
    }
    return liveReloadHub.subscribe(req);
  }

  // Health endpoint — no auth (also registered on routes; kept for trailing variants)
  if (
    path === '/health' ||
    path === '/health/' ||
    path === '/api/health' ||
    path === '/api/health/'
  )
    return health(req, server);
  if (path === '/health/pre' || path === '/health/pre/') return healthHtml(req, server);
  if (path === '/llms.txt') return llmsTxt();
  if (path === '/llms-full.txt') return llmsFullTxt();

  const md = await portalMarkdown(req);
  if (md) return md;

  // Bun API proof status
  if (path === '/api/proof' || path === '/api/proof/') return bunApiProof();
  if (path === '/api/env' || path === '/api/env/') return envStatus();
  if (path === '/api/content-type' || path === '/api/content-type/') return contentTypeApi();

  // Optional auth for read endpoints — public paths skip the gate
  const authErr = requireReadAuth(req);
  if (authErr) {
    const publicReadPaths = [
      '/api/monitoring',
      '/api/registry',
      '/api/dod',
      '/api/channels',
      '/api/operations/summary',
      '/api/catalog',
      '/api/skills',
      // Portal static chrome (HTML is route-matched; CSS/JS/modules hit fetch)
      '/portal/',
      // Static proof plane under public/registry/ (Pages parity; dashboard fetches JSON)
      '/registry/',
      // Tarball downloads are public (read plane) like npm metadata — auth is
      // publish-only. SDK download() must work without credentials.
      '/registry/storage/',
      // Scoped npm packuments (/@scope%2Fname) — public read plane.
      '/@',
    ];
    if (!publicReadPaths.some(p => path.startsWith(p))) return authErr;
  }
  if (path === '/api/monitoring' || path === '/api/monitoring/') return liveMonitoringApi();
  if (path === '/monitoring' || path === '/monitoring/') return monitoringPage();
  if (path === '/api/operations/summary' || path === '/api/operations/summary/')
    return liveOpsSummary();
  if (path === '/api/catalog' || path === '/api/catalog/') return liveCatalog(req);
  // Skills registry — local SKILL.md scan + *.skill package drop (never crashes)
  if (path === '/api/skills' || path === '/api/skills/') return json(await buildSkillsCatalog());

  // Registry
  if (path === '/api/registry' || path === '/api/registry/') return serveRegistryIndex();
  if (path === '/api/registry/registry.json') return serveRegistryIndex();
  if (path === '/api/registry/search') return searchRegistry(req);

  // Version endpoints: /api/registry/{name}/versions
  if (path.startsWith('/api/registry/') && path.endsWith('/versions')) {
    const name = path.slice(14, -9);
    if (req.method === 'GET') return listVersions(name);
    if (req.method === 'POST') return publishVersion(req, name);
    return json({ error: 'Method not allowed' }, 405);
  }

  // Registry health: GET /api/registry/health (un-shadow from packageDetail)
  if (
    (path === '/api/registry/health' || path === '/api/registry/health/') &&
    req.method === 'GET'
  ) {
    const idx = await Bun.file('public/registry/registry.json')
      .json()
      .catch(() => ({ packages: {} }));
    const packages = Object.keys(idx.packages ?? {});
    return json({
      ok: true,
      source: 'assets',
      packageCount: packages.length,
      timestamp: new Date().toISOString(),
    });
  }

  // Package detail: GET /api/registry/{name}
  if (path.startsWith('/api/registry/') && req.method === 'GET') {
    const name = path.slice(14);
    if (
      name &&
      name !== 'search' &&
      name !== 'registry.json' &&
      name !== 'health' &&
      !name.includes('/tenants/')
    ) {
      if (name.includes('/')) {
        const parts = name.split('/');
        if (parts.length === 2 && parts[0]!.startsWith('@')) return packageDetail(name);
      } else {
        return packageDetail(name);
      }
    }
  }

  // Tenant registries
  const tenantM = path.match(/^\/api\/registry\/tenants\/([^/]+)\/registry\.json$/);
  if (tenantM) {
    const f = Bun.file(`public/registry/${tenantM[1]}/registry.json`);
    if (await f.exists())
      return new Response(f, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    return json({ error: `No registry for tenant: ${tenantM[1]}` }, 404);
  }

  // DOD + Channels
  if (path === '/api/dod' || path === '/api/dod/' || path.startsWith('/api/dod/'))
    return dodApi(req);
  if (path === '/api/channels/events') return channelsEvents(req);

  const storageRes = await serveRegistryStorage(path, req);
  if (storageRes) return storageRes;

  const staticRes = await staticFile(path, req);
  if (staticRes) return staticRes;

  // npm-compatible publish: PUT /{name} or /@scope/name (not / or static paths)
  if (
    req.method === 'PUT' &&
    isNpmPackagePath(path) &&
    (path.match(/^\/@[a-z0-9-]+\/[a-zA-Z0-9._-]+$/) ||
      path.match(/^\/@[a-z0-9-]+%2[fF][a-zA-Z0-9._-]+$/) ||
      (path.length > 1 &&
        path.split('/').length === 2 &&
        path.startsWith('/') &&
        !path.startsWith('/@')))
  ) {
    return npmPublish(req, decodeURIComponent(path.slice(1)));
  }

  // npm-compatible metadata: GET /{name} or /@scope/name
  if (
    req.method === 'GET' &&
    isNpmPackagePath(path) &&
    (path.match(/^\/@[a-z0-9-]+\/[a-zA-Z0-9._-]+$/) ||
      path.match(/^\/@[a-z0-9-]+%2[fF][a-zA-Z0-9._-]+$/) ||
      (path.length > 1 &&
        path.split('/').length === 2 &&
        path.startsWith('/') &&
        !path.startsWith('/@')))
  ) {
    return npmPackageMetadata(req);
  }

  // API paths always JSON 404 so `curl | jq` fails with a clear error object
  if (path.startsWith('/api/')) {
    return json({ error: 'Not found', path, hint: 'Restart serve-public if route is new' }, 404);
  }
  return new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/**
 * Exact SIMD-matched routes (docs: exact > :param > wildcard).
 * Named params are type-safe via BunRequest string literals.
 * Static Response objects for fixed probes (zero-alloc dispatch).
 * @see https://bun.com/docs/runtime/http/routing#route-precedence
 * @see https://bun.com/docs/runtime/http/routing#static-responses
 */
function buildPublicRoutes() {
  /** Static ready probe — zero-allocation cloneable response (docs pattern). */
  const ready = new Response('Ready', {
    headers: { 'X-Ready': '1', 'Cache-Control': 'no-store' },
  });

  /** Portal HTML — file/hybrid via staticFile (Last-Modified / Range / HMR). */
  const portalPage =
    (urlPath: string) =>
    (req: Request): Promise<Response> =>
      staticFile(urlPath, req).then(r => r ?? new Response('Not found', { status: 404 }));

  return {
    // Exact static first (highest specificity)
    '/ready': ready,

    // Dynamic health — handlers receive (req, server) on TCP
    '/health': (req: Request, server: RouteServer) => health(req, server),
    '/health/': (req: Request, server: RouteServer) => health(req, server),
    '/api/health': (req: Request, server: RouteServer) => health(req, server),
    '/api/health/': (req: Request, server: RouteServer) => health(req, server),
    '/health/pre': (req: Request, server: RouteServer) => healthHtml(req, server),
    '/health/pre/': (req: Request, server: RouteServer) => healthHtml(req, server),

    '/': (req: Request): Promise<Response> =>
      staticFile('/index.html', req).then(r => r ?? new Response('Not found', { status: 404 })),
    '/index.html': (req: Request): Promise<Response> =>
      staticFile('/index.html', req).then(r => r ?? new Response('Not found', { status: 404 })),

    '/api/content-type': () => contentTypeApi(),
    '/api/content-type/': () => contentTypeApi(),
    '/api/proof': (req: Request) => {
      const hot = hotByUrl.get('/api/proof');
      if (hot) return respondStatic(hot, req, { cacheControl: 'public, max-age=30' });
      return bunApiProof();
    },
    '/api/defaults': async (req: Request) => {
      const f = Bun.file('public/registry/defaults-proof.json');
      if (!(await f.exists())) {
        return json(
          {
            error: 'Defaults proof not generated — run bun tools/verify-defaults.ts --save',
            docs: 'https://bun.com/docs/runtime/utils',
            _links: {
              script: '/api/defaults/script',
              pipe: 'curl -sf http://127.0.0.1:3000/api/defaults/script | bun run -',
            },
          },
          404
        );
      }
      const raw = JSON.parse(await f.text());
      const passed = raw.passed ?? raw.summary?.passed ?? 0;
      const total = raw.total ?? raw.summary?.total ?? 0;
      const url = new URL(req.url);
      const format = url.searchParams.get('format') || req.headers.get('Accept') || 'json';

      if (format === 'raw' || (format === 'application/json' && url.searchParams.has('format'))) {
        const cases = raw.results ?? raw.cases ?? raw.testCases;
        const body = cases && !raw.tests ? { ...raw, tests: cases } : raw;
        return json(body, 200, 'public, max-age=60');
      }
      if (format === 'text' || format.startsWith('text/')) {
        return new Response(
          `Bun Defaults Verification\n` +
            `Status: ${passed === total ? '✅ PASS' : '❌ FAIL'}\n` +
            `Passed: ${passed}/${total} (${total > 0 ? Math.round((passed / total) * 100) : 0}%)\n` +
            `Bun:    ${raw.bunVersion}\n` +
            `Hash:   ${raw.proofHash}\n`,
          {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'public, max-age=60',
            },
          }
        );
      }

      return json({
        status: passed === total ? 'pass' : 'fail',
        passed,
        total,
        passedRatio: +(passed / Math.max(total, 1)).toFixed(2),
        bunVersion: raw.bunVersion,
        proofHash: raw.proofHash,
        generated: raw.timestamp,
        results: raw.results ?? raw.cases ?? raw.testCases,
        tests: raw.results ?? raw.cases ?? raw.testCases,
        _links: {
          self: '/api/defaults',
          raw: '/api/defaults?format=raw',
          text: '/api/defaults?format=text',
          proof: '/registry/defaults-proof.json',
          script: '/api/defaults/script',
          // Contract note: local serves this normalized shape; the Pages edge
          // (functions/api/defaults.ts) passes the raw proof through.
          contract: 'normalized/local vs raw/edge — use ?format=raw for the edge shape',
          scriptMeta: '/api/defaults/script.meta',
          docs: 'https://bun.com/docs/runtime/utils',
        },
      });
    },
    '/api/defaults/script': (req: Request) =>
      serveVerificationScript('defaults', { baseUrl: new URL(req.url).origin }),
    '/api/defaults/script/': (req: Request) =>
      serveVerificationScript('defaults', { baseUrl: new URL(req.url).origin }),
    '/api/defaults/script.meta': (req: Request) =>
      serveVerificationScriptMeta('defaults', new URL(req.url).origin),
    '/api/sqlite/version': async () => {
      const db = new Database(':memory:');
      const v = db.query('SELECT sqlite_version() as v').get() as { v: string };
      return json({
        version: v.v,
        bunVersion: Bun.version,
        features: ['WAL mode', 'Synchronous NORMAL', 'Prepared statements', 'JSON functions'],
        docs: 'https://bun.sh/docs/runtime/sqlite',
      });
    },
    '/api/networking/script': (req: Request) =>
      serveVerificationScript('networking', { baseUrl: new URL(req.url).origin }),
    '/api/networking/script/': (req: Request) =>
      serveVerificationScript('networking', { baseUrl: new URL(req.url).origin }),
    '/api/networking/script.meta': (req: Request) =>
      serveVerificationScriptMeta('networking', new URL(req.url).origin),
    '/api/bun-defaults/script': (req: Request) =>
      serveVerificationScript('bun-defaults', { baseUrl: new URL(req.url).origin }),
    '/api/bun-defaults/script.meta': (req: Request) =>
      serveVerificationScriptMeta('bun-defaults', new URL(req.url).origin),
    '/api/release/script': (req: Request) =>
      serveVerificationScript('release', { baseUrl: new URL(req.url).origin }),
    '/api/release': async () => {
      const f = Bun.file('public/registry/release-features.json');
      if (await f.exists())
        return new Response(f, {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=60',
          },
        });
      return json({ error: 'Not generated' }, 404);
    },
    '/api/release/': async () => {
      const f = Bun.file('public/registry/release-features.json');
      if (await f.exists())
        return new Response(f, {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=60',
          },
        });
      return json({ error: 'Not generated' }, 404);
    },
    '/api/release/script/': (req: Request) =>
      serveVerificationScript('release', { baseUrl: new URL(req.url).origin }),
    '/api/release/script.meta': (req: Request) =>
      serveVerificationScriptMeta('release', new URL(req.url).origin),
    '/api/doc-refs': async () => {
      const f = Bun.file('public/registry/doc-index.json');
      if (!(await f.exists())) {
        return json(
          {
            error: 'Doc index not generated — run bun tools/build-doc-index.ts --save',
            _links: {
              script: '/api/doc-refs/script',
              pipe: 'curl -sf http://127.0.0.1:3000/api/doc-refs/script | bun run - --save',
            },
          },
          503
        );
      }
      return json(JSON.parse(await f.text()), 200, 'public, max-age=60');
    },
    '/api/doc-refs/script': (req: Request) =>
      serveVerificationScript('doc-index', { baseUrl: new URL(req.url).origin }),
    '/api/doc-refs/script/': (req: Request) =>
      serveVerificationScript('doc-index', { baseUrl: new URL(req.url).origin }),
    '/api/doc-refs/script.meta': (req: Request) =>
      serveVerificationScriptMeta('doc-index', new URL(req.url).origin),
    '/api/env': () => envStatus(),
    '/api/monitoring': () => liveMonitoringApi(),
    '/api/operations/summary': () => liveOpsSummary(),
    '/api/catalog': (req: Request) => liveCatalog(req),
    '/api/dod': (req: Request) => dodApi(req),
    '/api/channels/events': (req: Request) => channelsEvents(req),

    '/api/registry': () => serveRegistryIndex(),
    '/api/registry/registry.json': () => serveRegistryIndex(),
    '/api/registry/health': async () => {
      const idx = await Bun.file('public/registry/registry.json')
        .json()
        .catch(() => ({ packages: {} }));
      const packages = Object.keys(idx.packages ?? {});
      return json({
        ok: true,
        source: 'assets',
        packageCount: packages.length,
        timestamp: new Date().toISOString(),
      });
    },
    '/api/registry/static': () => serveStaticRegistry(),
    '/api/registry/search': (req: Request) => searchRegistry(req),

    // Unscoped package detail + versions (named params — type-safe)
    '/api/registry/:package': (req: BunRequest<'/api/registry/:package'>) => {
      const name = req.params.package;
      if (name === 'search' || name === 'registry.json' || name === 'static' || name === 'health') {
        return json({ error: 'Not found' }, 404);
      }
      return packageDetail(name);
    },
    '/api/registry/:package/versions': {
      GET: (req: BunRequest<'/api/registry/:package/versions'>) => listVersions(req.params.package),
      POST: (req: BunRequest<'/api/registry/:package/versions'>) =>
        publishVersion(req, req.params.package),
    },

    // Unencoded scoped package: /api/registry/@scope/name[/versions]
    '/api/registry/:scope/:name': (req: BunRequest<'/api/registry/:scope/:name'>) => {
      const { scope, name } = req.params;
      if (!scope.startsWith('@')) return json({ error: 'Not found' }, 404);
      return packageDetail(`${scope}/${name}`);
    },
    '/api/registry/:scope/:name/versions': {
      GET: (req: BunRequest<'/api/registry/:scope/:name/versions'>) =>
        listVersions(`${req.params.scope}/${req.params.name}`),
      POST: (req: BunRequest<'/api/registry/:scope/:name/versions'>) =>
        publishVersion(req, `${req.params.scope}/${req.params.name}`),
    },

    '/monitoring': () => monitoringPage(),
    '/llms.txt': llmsTxt(),

    '/__hmr': (req: Request, server: RouteServer) => {
      if (server?.timeout) {
        try {
          server.timeout(req, 0);
        } catch {
          /* ignore */
        }
      }
      return liveReloadHub
        ? liveReloadHub.subscribe(req)
        : json({ error: 'live-reload disabled' }, 404);
    },

    // Portal dashboards — exact routes (file strategy under the hood)
    '/portal': portalPage('/portal/index.html'),
    '/portal/': portalPage('/portal/index.html'),
    '/portal/ops': portalPage('/portal/ops/'),
    '/portal/ops/': portalPage('/portal/ops/'),
    '/portal/health': portalPage('/portal/health/'),
    '/portal/health/': portalPage('/portal/health/'),
    '/portal/env': portalPage('/portal/env/'),
    '/portal/env/': portalPage('/portal/env/'),
    '/portal/dod': portalPage('/portal/dod/'),
    '/portal/dod/': portalPage('/portal/dod/'),
    '/portal/dashboard': portalPage('/portal/dashboard/'),
    '/portal/dashboard/': portalPage('/portal/dashboard/'),
    '/portal/catalog': portalPage('/portal/catalog/'),
    '/portal/catalog/': portalPage('/portal/catalog/'),
    '/portal/skills': portalPage('/portal/skills/'),
    '/portal/skills/': portalPage('/portal/skills/'),
  };
}

function isListenPortBusy(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('EADDRINUSE') || /port \d+ in use/i.test(msg);
}

function createServer(options: Pick<BunServeOptions, 'port' | 'hostname'> = {}): BunServer {
  const routes = buildPublicRoutes();
  const serveOptions: BunServeOptions = {
    development: SERVE_DEVELOPMENT,
    routes,
    fetch: fetchHandler,
    error(error) {
      console.error('[serve] unhandled:', error);
      return new Response('Internal Server Error', { status: 500 });
    },
  };
  if (HOST_OVERRIDE) serveOptions.hostname = HOST_OVERRIDE;
  else if (options.hostname !== undefined) serveOptions.hostname = options.hostname;
  if (options.port !== undefined) serveOptions.port = options.port;

  return Bun.serve(serveOptions);
}

/**
 * Probe whether something already listens on the resolved default port.
 * Bun's listener uses SO_REUSEPORT on some platforms, so a second bind can
 * SUCCEED (no EADDRINUSE) while traffic round-robins across stale instances —
 * the bind-time check alone is not enough. A connect probe is deterministic.
 */
async function probeDefaultPortBusy(): Promise<boolean> {
  const port = resolveBunServeDefaultPort();
  if (port === 0) return false;
  const host = HOST_OVERRIDE ?? '127.0.0.1';
  try {
    const socket = await Bun.connect({
      hostname: host,
      port,
      socket: {
        data() {},
        open(s) {
          s.end();
        },
        error() {},
      },
    });
    socket.end();
    return true;
  } catch {
    return false;
  }
}

/**
 * Start with Bun-native bind: omit `port`/`hostname` so `--port`, env chain, and docs defaults apply.
 * On EADDRINUSE (or a positive busy probe), retry once with `port: 0` (ephemeral).
 * @see https://bun.com/docs/runtime/http/server#changing-the-port-and-hostname
 * @see https://bun.com/docs/runtime/http/server#configuring-a-default-port
 */
async function startServer(): Promise<ServeBindSnapshot & { ephemeralFallback: boolean }> {
  if (await probeDefaultPortBusy()) {
    console.warn(
      `[serve] default port ${resolveBunServeDefaultPort()} already listening — binding ephemeral port instead`
    );
    return { ...serveBindSnapshot(createServer({ port: 0 })), ephemeralFallback: true };
  }

  let lastErr: unknown;
  try {
    return { ...serveBindSnapshot(createServer()), ephemeralFallback: false };
  } catch (e) {
    lastErr = e;
    if (!isListenPortBusy(e)) throw e;
  }

  try {
    console.warn(
      `[serve] default port ${resolveBunServeDefaultPort()} busy — retrying with port: 0 (ephemeral)`
    );
    return { ...serveBindSnapshot(createServer({ port: 0 })), ephemeralFallback: true };
  } catch (e) {
    lastErr = e;
  }

  const expected = resolveBunServeDefaultPort();
  console.error(`
Failed to bind serve-public on ${HOST_OVERRIDE ?? '(Bun default hostname)'} port ${expected}.

  # Free the default port, then re-run (Bun resolves --port → BUN_PORT → PORT → NODE_PORT → 3000):
  lsof -nP -iTCP:${expected} -sTCP:LISTEN
  kill <PID>

  bun --port=3010 scripts/serve-public.ts
  BUN_PORT=3010 bun scripts/serve-public.ts
  HOST=0.0.0.0 bun scripts/serve-public.ts
`);
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const bind = await startServer();
const { port: boundPort, hostname: boundHost, protocol: boundProtocol, ephemeralFallback } = bind;
activeServer = bind.server;
const base = bind.loopbackOrigin;

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`${signal} — graceful stop (server.stop)…`);
  try {
    liveReloadHub?.stop();
  } catch {
    /* ignore */
  }
  try {
    if (activeServer) await activeServer.stop(false);
  } catch (e) {
    console.error('server.stop failed:', e);
    try {
      await activeServer?.stop(true);
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
}

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});

console.log(`Local portal:  ${base}/portal/ops/`);
console.log(`Monitoring:    ${base}/monitoring`);
console.log(`Live API:      ${base}/api/operations/summary`);
console.log(`Monitoring API ${base}/api/monitoring`);
console.log(`Registry:      ${base}/api/registry`);
console.log(`Catalog:       ${base}/api/catalog`);
console.log(`Prediction:    ${base}/registry/prediction/report.html`);
const publishReady = Boolean(configuredPublishToken());
console.log(
  publishReady
    ? `Publish:       PUT ${base}/{name} (Bearer REGISTRY_SECRET required)`
    : `Publish:       disabled — set REGISTRY_SECRET or FACTORY_WAGER_TOKEN`
);
console.log(
  `Bind: ${boundProtocol}://${boundHost}:${boundPort} (url.port=${bind.urlPort || 'default'})  DB: ${dbPath}`
);
console.log(
  `Serve:         development=${bind.development} · protocol=${bind.protocol} · origin=${bind.origin} · loopback=${base} · routes=SIMD+static · fetch=unmatched`
);
if (ephemeralFallback) {
  console.log(
    `(default port busy — bound ephemeral port ${boundPort}; set BUN_PORT/PORT or bun --port=…)`
  );
}
if (LIVE_RELOAD && liveReloadHub) {
  await liveReloadHub.startPolling(WATCH_PATHS);
  console.log(
    `HMR:           browser live-reload ON (SSE ${base}/__hmr) · poll ${WATCH_PATHS.length} paths`
  );
  console.log(
    `               server HMR: bun --hot scripts/serve-public.ts · off: SERVE_PUBLIC_HMR=0`
  );
} else {
  console.log(`HMR:           off (set SERVE_PUBLIC_HMR=1 or bind 127.0.0.1)`);
}

// In-process Bun.cron complement: refresh snapshots while the portal is up.
// UTC schedule, no-overlap (next fire waits for snapshot Promise).
// @see https://bun.com/docs/runtime/cron#bun-cron-schedule-handler-in-process
if (Bun.env.OPS_SNAPSHOT_CRON === '1') {
  const { registerOpsSnapshotCron, OPS_SNAPSHOT_SCHEDULE } = await import(
    '../lib/operations/snapshot-cron.ts'
  );
  registerOpsSnapshotCron();
  console.log(
    `Cron:          ops-snapshot @ ${OPS_SNAPSHOT_SCHEDULE} UTC (in-process Bun.cron, no-overlap)`
  );
}

// Nightly Bun defaults verification (12 cases → public/registry/bun-defaults-proof.json)
// @see https://bun.com/docs/runtime/cron#bun-cron-schedule-handler-in-process
// Schedule: Bun.cron("0 4 * * *", handler) — UTC, no-overlap (not title-first overload)
if (Bun.env.BUN_DEFAULTS_CRON === '1') {
  const { registerDefaultsVerifyCron, BUN_DEFAULTS_CRON_SCHEDULE, BUN_DEFAULTS_PROOF_PATH } =
    await import('../lib/http/defaults-cron.ts');
  registerDefaultsVerifyCron();
  console.log(
    `Cron:          defaults-verify @ ${BUN_DEFAULTS_CRON_SCHEDULE} UTC → ${BUN_DEFAULTS_PROOF_PATH}`
  );
}
