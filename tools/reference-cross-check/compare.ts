#!/usr/bin/env bun
/**
 * Ledger + comparison engine for the reference cross-check (178).
 *
 * Every ledger claim pins: (a) the official bun-types text (fragment in a
 * bundle-relative source file) and (b) the observed value in
 * tools/build-artifact-evidence.json (dotted evidencePath). The verdict
 * classifies doc-vs-runtime agreement:
 *   CONSISTENT        - fragment present AND observed value exists
 *   PINNED-DISCREPANCY- fragment present, doc and observation deliberately
 *                       disagree (our correction; non-fatal)
 *   DOC-CHANGED       - fragment NOT found in the pinned docs (fatal: the
 *                       pin's premise moved - re-verify)
 *   NO-EVIDENCE       - evidencePath does not resolve (fatal: ledger bug)
 */
import type { Evidence } from './evidence-loader.ts';
import { resolvePath } from './evidence-loader.ts';

export type LedgerKind = 'consistent' | 'discrepancy';

export interface LedgerClaim {
  id: string;
  api: string;
  source: string; // path relative to the bundle root (e.g. 'bun.d.ts', 'docs/bundler/index.mdx')
  fragment: string; // distinctive text that must be present in source
  docSays: string;
  evidencePath: string;
  kind: LedgerKind;
}

export type Verdict = 'CONSISTENT' | 'PINNED-DISCREPANCY' | 'DOC-CHANGED' | 'NO-EVIDENCE';

export interface CheckResult {
  claim: LedgerClaim;
  verdict: Verdict;
  docFound: boolean;
  observed: unknown;
}

export const LEDGER: LedgerClaim[] = [
  // ---- BuildArtifact surface (findings 1) ----
  { id: 'BA-extendsBlob', api: 'kind', source: 'docs/bundler/index.mdx', fragment: 'interface BuildArtifact extends Blob', docSays: 'BuildArtifact extends Blob (Blob methods incl. .bytes()/.image() would apply)', evidencePath: 'surface.methods.instanceofBlob', kind: 'discrepancy' },
  { id: 'BA-kinds', api: 'kind', source: 'bun.d.ts', fragment: 'kind: "entry-point" | "chunk" | "asset" | "sourcemap" | "bytecode"', docSays: 'kind is one of five output roles', evidencePath: 'scenarios.S03-splitting.observed.kinds', kind: 'consistent' },
  { id: 'BA-hash', api: 'hash', source: 'bun.d.ts', fragment: 'hash: string | null', docSays: 'hash is string | null', evidencePath: 'scenarios.S04-sourcemap-linked.outputs[1].hash', kind: 'consistent' },

  // ---- BuildConfig options (findings 2) ----
  { id: 'BC-outfile', api: 'outfile', source: 'bun.d.ts', fragment: 'outfile?: string', docSays: 'outfile: single output file path', evidencePath: 'scenarios.S19-outfile.observed.writtenAtOutfilePath', kind: 'discrepancy' },
  { id: 'BC-env', api: 'env', source: 'bun.d.ts', fragment: 'Controls how environment variables are handled during bundling', docSays: 'env: "inline" injects env values into the output', evidencePath: 'scenarios.S12-env-inline.observed.substituted', kind: 'discrepancy' },
  { id: 'BC-allowUnresolved', api: 'allowUnresolved', source: 'bun.d.ts', fragment: 'Control whether dynamic', docSays: 'allowUnresolved: glob allow-lists pass dynamic import() through', evidencePath: 'scenarios.S14-allowUnresolved-glob.ok', kind: 'discrepancy' },
  { id: 'BC-bytecode', api: 'bytecode', source: 'bun.d.ts', fragment: 'Generate bytecode for the output', docSays: 'bytecode: true emits bytecode', evidencePath: 'scenarios.S06-bytecode.observed.kinds', kind: 'consistent' },
  { id: 'BC-compile', api: 'compile', source: 'bun.d.ts', fragment: 'compile?: boolean | Bun.Build.CompileTarget | CompileBuildOptions', docSays: 'compile: standalone executable', evidencePath: 'scenarios.S07a-compile-outdir.observed.written', kind: 'consistent' },
  { id: 'BC-define', api: 'define', source: 'bun.d.ts', fragment: 'define?: Record<string, string>', docSays: 'define: replace expressions with constants', evidencePath: 'scenarios.S11-define.observed.inlined', kind: 'consistent' },
  { id: 'BC-drop', api: 'drop', source: 'bun.d.ts', fragment: 'Drop function calls to matching property accesses', docSays: 'drop: remove matching calls', evidencePath: 'scenarios.S13b-drop-on.observed.hasConsoleLog', kind: 'consistent' },
  { id: 'BC-sourcemap', api: 'sourcemap', source: 'bun.d.ts', fragment: 'Specifies if and how to generate source maps', docSays: 'sourcemap: none/linked/external/inline', evidencePath: 'scenarios.S04-sourcemap-inline.observed.inlineBase64', kind: 'consistent' },
  { id: 'BC-minify', api: 'minify', source: 'bun.d.ts', fragment: 'Whether to enable minification', docSays: 'minify: boolean or granular object', evidencePath: 'scenarios.S10-minify-on.outputs[0].size', kind: 'consistent' },
  { id: 'BC-conditions', api: 'conditions', source: 'bun.d.ts', fragment: 'conditions used when resolving imports', docSays: 'conditions: package.json exports conditions', evidencePath: 'scenarios.S16b-conditions-custom.observed.resolvedMarker', kind: 'consistent' },
  { id: 'BC-publicPath', api: 'publicPath', source: 'bun.d.ts', fragment: 'publicPath?: string', docSays: 'publicPath: prefix for asset paths', evidencePath: 'scenarios.S17-publicPath.observed.jsReferencesCdn', kind: 'consistent' },
  { id: 'BC-root', api: 'root', source: 'bun.d.ts', fragment: 'root?: string;', docSays: 'root: override project root for output structure', evidencePath: 'scenarios.S18b-root-set.outputs[0].path', kind: 'consistent' },
  { id: 'BC-naming', api: 'naming', source: 'bun.d.ts', fragment: 'asset?: string;', docSays: 'naming: string applies to entrypoints only', evidencePath: 'scenarios.S05a-naming-string.observed.entryPaths', kind: 'consistent' },
  { id: 'BC-external', api: 'external', source: 'bun.d.ts', fragment: 'external?: string[]', docSays: 'external: exclude packages from bundle', evidencePath: 'scenarios.S15a-external-zod.observed.keptImport', kind: 'consistent' },
  { id: 'BC-target', api: 'target', source: 'bun.d.ts', fragment: '@default "browser"', docSays: 'target: browser | bun | node', evidencePath: 'scenarios.S08-target-bun.outputs[0].size', kind: 'consistent' },

  // ---- Bun.Image (findings 5-8) ----
  { id: 'IM-autoOrient', api: 'autoOrient', source: 'bun.d.ts', fragment: 'Apply EXIF Orientation (JPEG) before any other operation.', docSays: 'autoOrient defaults to true (EXIF applied)', evidencePath: 'imageCtorGotchas.autoOrient.exifOrientation6Default', kind: 'consistent' },
  { id: 'IM-maxPixels', api: 'maxPixels', source: 'bun.d.ts', fragment: '268402689', docSays: 'maxPixels default 268402689 (0x3FFF^2, same as Sharp)', evidencePath: 'imageCtorGotchas.maxPixels.typeDocDefault', kind: 'consistent' },
  { id: 'IM-withoutEnlargement', api: 'withoutEnlargement', source: 'bun.d.ts', fragment: 'Never upscale', docSays: 'withoutEnlargement prevents upscaling', evidencePath: 'computeGuideGotchas.withoutEnlargement.withOptionResult', kind: 'consistent' },
  { id: 'IM-progressive', api: 'progressive', source: 'bun.d.ts', fragment: 'Emit a progressive (multi-scan) JPEG', docSays: 'jpeg progressive: true emits multi-scan', evidencePath: 'computeGuideGotchas.progressiveJpeg.progressiveHasSOF2', kind: 'consistent' },
  { id: 'IM-palette', api: 'palette', source: 'bun.d.ts', fragment: 'Quantize to a palette and emit indexed (colour-type 3) PNG', docSays: 'png palette: true emits indexed PNG', evidencePath: 'computeGuideGotchas.palettePng.palette64ColorType', kind: 'consistent' },
  { id: 'IM-invalidState', api: 'ERR_INVALID_STATE', source: 'bun.d.ts', fragment: 'the input ArrayBuffer was transferred between', docSays: 'transferred input -> ERR_INVALID_STATE', evidencePath: 'imageCtorGotchas.bufferGuards.transferredBetweenCtorAndTerminal', kind: 'discrepancy' },
  { id: 'BC-banner', api: 'banner', source: 'bun.d.ts', fragment: 'banner?: string', docSays: 'banner: prepend text to bundled code', evidencePath: 'configGapsGotchas.bannerFooter.bannerAtTop', kind: 'consistent' },
  { id: 'BC-footer', api: 'footer', source: 'bun.d.ts', fragment: 'footer?: string', docSays: 'footer: append text to bundled code', evidencePath: 'configGapsGotchas.bannerFooter.footerAtEnd', kind: 'consistent' },
  { id: 'BC-throw', api: 'throw', source: 'bun.d.ts', fragment: 'throw?: boolean', docSays: 'throw:false returns { success:false } instead of rejecting', evidencePath: 'configGapsGotchas.throwOption.throwFalseReturnsSuccessFalse', kind: 'consistent' },
  { id: 'BC-packages', api: 'packages', source: 'bun.d.ts', fragment: 'packages?: "bundle" | "external"', docSays: 'packages: external leaves package imports external', evidencePath: 'configGapsGotchas.packagesExternal.importKept', kind: 'consistent' },
  { id: 'BC-features', api: 'features', source: 'bun.d.ts', fragment: 'features?: string[]', docSays: 'features: bun:bundle feature() dead-code elimination', evidencePath: 'configGapsGotchas.features.withFlag_keepsA', kind: 'consistent' },
  { id: 'BC-tsconfig', api: 'tsconfig', source: 'bun.d.ts', fragment: 'tsconfig?: string', docSays: 'tsconfig: custom tsconfig for path resolution', evidencePath: 'configGapsGotchas.tsconfigPaths.prefixedAliasResolves', kind: 'consistent' },
  { id: 'BC-jsx', api: 'jsx', source: 'bun.d.ts', fragment: 'jsx?: {', docSays: 'jsx: classic factory / automatic runtime transform', evidencePath: 'configGapsGotchas.jsxClassic.factoryHonored', kind: 'consistent' },
  { id: 'BC-ignoreDCEAnnotations', api: 'ignoreDCEAnnotations', source: 'bun.d.ts', fragment: 'Ignore dead code elimination', docSays: 'ignoreDCEAnnotations keeps @__PURE__ calls', evidencePath: 'configGapsGotchas.dceAnnotations.keptWithIgnoreDCEAnnotations', kind: 'consistent' },
  { id: 'BC-emitDCEAnnotations', api: 'emitDCEAnnotations', source: 'bun.d.ts', fragment: 'Force emitting @__PURE__', docSays: 'emitDCEAnnotations forces @__PURE__ marks under whitespace minify', evidencePath: 'configGapsGotchas.dceAnnotations.pureMarkEmittedWithEmitFlag', kind: 'consistent' },
  { id: 'BC-optimizeImports', api: 'optimizeImports', source: 'bun.d.ts', fragment: 'optimizeImports?: string[]', docSays: 'optimizeImports: skip unused barrel re-exports', evidencePath: 'configGapsGotchas.optimizeImports.accepted', kind: 'consistent' },
  { id: 'BC-files', api: 'files', source: 'bun.d.ts', fragment: 'files?: Record<string, string', docSays: 'files: virtual in-memory files for bundling (not standalone-embedded)', evidencePath: 'configGapsGotchas.reactAndFiles.filesVirtualBundle', kind: 'consistent' },
  { id: 'BC-reactFastRefresh', api: 'reactFastRefresh', source: 'bun.d.ts', fragment: 'Enable React Fast Refresh transform', docSays: 'reactFastRefresh: adds refresh registration markers', evidencePath: 'configGapsGotchas.reactAndFiles.reactFastRefresh.honored', kind: 'consistent' },
  { id: 'BC-reactCompiler', api: 'reactCompiler', source: 'bun.d.ts', fragment: 'Run the React Compiler over', docSays: 'reactCompiler: auto-memoization (guard checks); client mode needs react/compiler-runtime', evidencePath: 'configGapsGotchas.reactAndFiles.reactCompiler.honored', kind: 'consistent' },
  { id: 'BC-reactCompilerOutputMode', api: 'reactCompilerOutputMode', source: 'bun.d.ts', fragment: 'Output mode for the React Compiler', docSays: 'reactCompilerOutputMode: ssr skips the useMemoCache runtime (builds without compiler-runtime)', evidencePath: 'configGapsGotchas.reactAndFiles.reactCompilerOutputMode.ssrVsClientDiffer', kind: 'consistent' },
  { id: 'SV-methodRoutes', api: 'routes', source: 'serve.d.ts', fragment: 'Partial<Record<HTTPMethod, Handler', docSays: 'routes: method-keyed handlers + :id params', evidencePath: 'serveGotchas.methodRoutes.getParams', kind: 'consistent' },
  { id: 'SV-staticValue', api: 'routes', source: 'serve.d.ts', fragment: 'BaseRouteValue = Response | false | HTMLBundle | BunFile | DirectoryRouteOptions', docSays: 'routes: static Response/BunFile values', evidencePath: 'serveGotchas.staticRoutes.valueRoute', kind: 'consistent' },
  { id: 'SV-directory', api: 'routes', source: 'serve.d.ts', fragment: 'interface DirectoryRouteOptions', docSays: 'routes: "/*" directory serving', evidencePath: 'serveGotchas.directoryRoute.fileContent', kind: 'consistent' },
  { id: 'SV-websocket', api: 'websocket', source: 'serve.d.ts', fragment: 'websocket: WebSocketHandler<WebSocketData>', docSays: 'websocket: open/message/close + server.upgrade()', evidencePath: 'serveGotchas.websocket.echo', kind: 'consistent' },
  { id: 'SV-error', api: 'error', source: 'serve.d.ts', fragment: 'Called when an error is thrown during request handling', docSays: 'error: handler maps thrown errors to a Response', evidencePath: 'serveGotchas.errorHandler.status', kind: 'consistent' },
  { id: 'SV-port', api: 'port', source: 'serve.d.ts', fragment: 'port?: string | number', docSays: 'port: 0 assigns an ephemeral port (server.port)', evidencePath: 'serveGotchas.errorHandler.port0Assigned', kind: 'consistent' },
  { id: 'SV-fetch', api: 'fetch', source: 'serve.d.ts', fragment: 'fetch?(this: Server<WebSocketData>, req: Request', docSays: 'fetch: fallback handler for unmatched routes', evidencePath: 'serveGotchas.staticRoutes.fetchFallback', kind: 'consistent' },
  { id: 'SQ-queryGet', api: 'query', source: 'sqlite.d.ts', fragment: 'Maximum number of distinct SQL strings', docSays: 'query: cached statement (MAX_QUERY_CACHE_SIZE)', evidencePath: 'sqliteGotchas.queryGet', kind: 'consistent' },
  { id: 'SQ-namedParams', api: 'run', source: 'sqlite.d.ts', fragment: 'no longer need the', docSays: 'named-param keys need no $/:@ prefix (docs claim) - true ONLY in strict mode', evidencePath: 'sqliteGotchas.namedParams.defaultPrefixed', kind: 'discrepancy' },
  { id: 'SQ-runChanges', api: 'run', source: 'sqlite.d.ts', fragment: 'lastInsertRowid', docSays: 'run: returns changes + lastInsertRowid', evidencePath: 'sqliteGotchas.runChanges', kind: 'consistent' },
  { id: 'SQ-transaction', api: 'transaction', source: 'sqlite.d.ts', fragment: 'transaction', docSays: 'transaction: atomic rollback', evidencePath: 'sqliteGotchas.transactionAtomic', kind: 'consistent' },
  { id: 'SQ-serialize', api: 'serialize', source: 'sqlite.d.ts', fragment: 'sqlite3_serialize', docSays: 'serialize: Buffer dump', evidencePath: 'sqliteGotchas.serializeDeserialize.roundTripName', kind: 'consistent' },
  { id: 'SQ-deserialize', api: 'deserialize', source: 'sqlite.d.ts', fragment: 'static deserialize', docSays: 'deserialize: STATIC Database.deserialize (not instance)', evidencePath: 'sqliteGotchas.serializeDeserialize.roundTripName', kind: 'consistent' },
  { id: 'SQ-close', api: 'close', source: 'sqlite.d.ts', fragment: 'been finalized or collected', docSays: 'close: later queries throw', evidencePath: 'sqliteGotchas.closedDbError', kind: 'consistent' },
  { id: 'SQ-constraint', api: 'run', source: 'sqlite.d.ts', fragment: 'SQLITE_CONSTRAINT', docSays: 'constraint violations carry a SQLITE_* code', evidencePath: 'sqliteGotchas.constraintErrorCode', kind: 'consistent' },
  { id: 'UP-global', api: 'URLPattern', source: 'node url.d.ts', fragment: 'interface URLPattern', docSays: 'URLPattern is a runtime global (Web API); NOT declared in bun-types (shape gap) - typed via @types/node', evidencePath: 'urlPatternGotchas.global.typeof', kind: 'consistent' },
  { id: 'UP-init', api: 'URLPattern', source: 'node url.d.ts', fragment: 'interface URLPatternInit', docSays: 'URLPatternInit object form ({ pathname: "/users/:id" })', evidencePath: 'urlPatternGotchas.objectForm.id', kind: 'consistent' },
  { id: 'UP-test', api: 'test', source: 'node url.d.ts', fragment: 'test(input?: URLPatternInput', docSays: 'test: boolean match', evidencePath: 'urlPatternGotchas.objectForm.test', kind: 'consistent' },
  { id: 'UP-exec', api: 'exec', source: 'node url.d.ts', fragment: 'exec(input?: URLPatternInput', docSays: 'exec: result with pathname.groups', evidencePath: 'urlPatternGotchas.objectForm.id', kind: 'consistent' },
  { id: 'UP-regex', api: 'hasRegExpGroups', source: 'node url.d.ts', fragment: 'readonly hasRegExpGroups', docSays: 'hasRegExpGroups: true with regex groups', evidencePath: 'urlPatternGotchas.regexGroup.hasRegExpGroups', kind: 'consistent' },
  { id: 'UP-components', api: 'pathname', source: 'node url.d.ts', fragment: 'readonly pathname', docSays: 'component getters: protocol/hostname/port/pathname/search/hash', evidencePath: 'urlPatternGotchas.componentGetters.pathname', kind: 'consistent' },
  { id: 'SQ-iterate', api: 'iterate', source: 'sqlite.d.ts', fragment: 'iterate(', docSays: 'Statement.iterate: row iterator', evidencePath: 'gapCloseGotchas.statement.iterateRows', kind: 'consistent' },
  { id: 'SQ-raw', api: 'raw', source: 'sqlite.d.ts', fragment: 'raw(...params', docSays: 'Statement.raw() is a METHOD returning Array<Array<Uint8Array|null>> (raw=true assignment is a no-op)', evidencePath: 'gapCloseGotchas.statement.rawMethodValue', kind: 'consistent' },
  { id: 'SQ-finalize', api: 'finalize', source: 'sqlite.d.ts', fragment: 'finalize(', docSays: 'Statement.finalize: later calls throw', evidencePath: 'gapCloseGotchas.statement.finalizeThrows', kind: 'consistent' },
  { id: 'SQ-toString', api: 'toString', source: 'sqlite.d.ts', fragment: 'toString(', docSays: 'Statement.toString: returns the SQL', evidencePath: 'gapCloseGotchas.statement.finalizeSql', kind: 'consistent' },
  { id: 'UP-baseURL', api: 'baseURL', source: 'node url.d.ts', fragment: 'baseURL', docSays: 'URLPatternInit.baseURL: base for relative patterns', evidencePath: 'gapCloseGotchas.urlPatternBaseURL.test', kind: 'consistent' },
  { id: 'SV-maxRequestBodySize', api: 'maxRequestBodySize', source: 'serve.d.ts', fragment: 'maximum size of a request body', docSays: 'maxRequestBodySize: oversized POST rejected', evidencePath: 'gapCloseGotchas.serveMaxRequestBody.overStatus', kind: 'consistent' },
  { id: 'BC-jsxFragment', api: 'fragment', source: 'bun.d.ts', fragment: 'fragment?: string', docSays: 'jsx fragment: custom Fragment element', evidencePath: 'gapCloseGotchas.jsxFragment.fragmentHonored', kind: 'consistent' },
  { id: 'BC-jsxSideEffects', api: 'sideEffects', source: 'bun.d.ts', fragment: 'sideEffects?: boolean', docSays: 'jsx sideEffects: accepted', evidencePath: 'gapCloseGotchas.jsxFragment.sideEffectsAccepted', kind: 'consistent' },
  { id: 'CR-parse', api: 'cron', source: 'bun.d.ts', fragment: 'previews the next', docSays: 'cron.parse: deterministic next-fire-time', evidencePath: 'cronGotchas.parseEveryMinuteUtc', kind: 'consistent' },
  { id: 'CR-schedule', api: 'cron', source: 'bun.d.ts', fragment: 'minute hour day-of-month month day-of-week', docSays: '5-field cron expression', evidencePath: 'cronGotchas.parseEveryMinuteUtc', kind: 'consistent' },
  { id: 'CR-nickname', api: 'cron', source: 'bun.d.ts', fragment: '@yearly', docSays: 'nicknames (@daily etc.)', evidencePath: 'cronGotchas.parseNicknameUtc', kind: 'consistent' },
  { id: 'CR-tz', api: 'tz', source: 'bun.d.ts', fragment: 'IANA time-zone name to interpret the schedule', docSays: 'tz option honored (UTC/NY differ; default = system local)', evidencePath: 'cronGotchas.parseTzUtc', kind: 'consistent' },
  { id: 'CR-invalid', api: 'cron', source: 'bun.d.ts', fragment: 'Validated at runtime by the cron parser', docSays: 'invalid expressions throw at runtime', evidencePath: 'cronGotchas.invalidThrows', kind: 'consistent' },
  { id: 'CR-job', api: 'cron', source: 'bun.d.ts', fragment: 'Cancel this cron job', docSays: 'CronJob handle: cron/stop/ref/unref', evidencePath: 'cronGotchas.jobSurface', kind: 'consistent' },
  { id: 'WV-navigate', api: 'navigate', source: 'bun.d.ts', fragment: 'navigate(url: string): Promise<void>', docSays: 'WebView.navigate: data: URLs work offline', evidencePath: 'webviewGotchas.navigateData.urlPrefix', kind: 'consistent' },
  { id: 'WV-evaluate', api: 'evaluate', source: 'bun.d.ts', fragment: 'evaluate<T = unknown>(script: string)', docSays: 'WebView.evaluate (NOT eval): DOM + expression eval', evidencePath: 'webviewGotchas.evaluate.domText', kind: 'consistent' },
  { id: 'WV-screenshot', api: 'screenshot', source: 'bun.d.ts', fragment: 'screenshot(options?: { encoding?: "blob"', docSays: 'WebView.screenshot: png buffer', evidencePath: 'webviewGotchas.screenshotPng.ok', kind: 'consistent' },
  { id: 'WV-surface', api: 'loading', source: 'bun.d.ts', fragment: 'readonly loading: boolean', docSays: 'WebView surface: url/title/loading + navigate/evaluate/screenshot/cdp/click', evidencePath: 'webviewGotchas.surface.navigate', kind: 'consistent' },
  { id: 'WV-close', api: 'close', source: 'bun.d.ts', fragment: 'close(): void', docSays: 'WebView disposal: close() + Symbol.dispose (no destroy)', evidencePath: 'webviewGotchas.surface.close', kind: 'consistent' },
  { id: 'S3-file', api: 'S3File', source: 's3.d.ts', fragment: 'interface S3File extends Blob', docSays: 'S3File: Blob-extending surface (name/size/type/lastModified + read methods)', evidencePath: 's3Gotchas.fileSurface.name', kind: 'consistent' },
  { id: 'S3-presign', api: 'presign', source: 's3.d.ts', fragment: 'Number of seconds until the presigned URL expires', docSays: 'S3File.presign: needs credentials (rejects offline)', evidencePath: 's3Gotchas.noCreds.presign', kind: 'consistent' },
  { id: 'S3-slice', api: 'slice', source: 's3.d.ts', fragment: 'A new S3File representing the specified range', docSays: 'S3File.slice: range views', evidencePath: 's3Gotchas.fileSurface.slice', kind: 'consistent' },
  { id: 'S3-stats', api: 'stat', source: 's3.d.ts', fragment: 'interface S3Stats', docSays: 'S3File.stat: S3Stats (needs creds)', evidencePath: 's3Gotchas.noCreds.stat', kind: 'consistent' },
  { id: 'S3-noRead', api: 'read', source: 's3.d.ts', fragment: 'interface S3File extends Blob', docSays: 'S3File has NO .read() (use text/json/image/slice/arrayBuffer)', evidencePath: 's3Gotchas.fileSurface.read', kind: 'consistent' },
  { id: 'WV-backForward', api: 'back', source: 'bun.d.ts', fragment: 'back():', docSays: 'WebView back/forward DECLARED in types but ABSENT at runtime on 1.4.0', evidencePath: 'webviewGotchas.gapSurface.back', kind: 'discrepancy' },
  { id: 'WV-scrollTo', api: 'scrollTo', source: 'bun.d.ts', fragment: 'scrollTo(', docSays: 'WebView.scrollTo is SELECTOR-based (numeric args throw)', evidencePath: 'webviewGotchas.scrollToSelectorBased', kind: 'consistent' },
  { id: 'WV-surface2', api: 'reload', source: 'bun.d.ts', fragment: 'reload()', docSays: 'WebView: closeAll/addEventListener/reload/resize present', evidencePath: 'webviewGotchas.reloadOk', kind: 'consistent' },
  { id: 'S3-fileDataOptions', api: 'data', source: 's3.d.ts', fragment: 'interface S3File extends Blob', docSays: 'S3File data/options DECLARED in types but ABSENT at runtime on 1.4.0', evidencePath: 's3Gotchas.fileDataOptions.data', kind: 'discrepancy' },
  { id: 'S3-list', api: 'list', source: 's3.d.ts', fragment: 'list(', docSays: 'S3Client.list: needs credentials (rejects offline)', evidencePath: 's3Gotchas.clientList', kind: 'consistent' },
  { id: 'SV-id', api: 'id', source: 'serve.d.ts', fragment: 'readonly id: string', docSays: 'Server.id: reflects the serve id option', evidencePath: 'deepPassGotchas.serve.id', kind: 'consistent' },
  { id: 'SV-reusePort', api: 'reusePort', source: 'serve.d.ts', fragment: 'SO_REUSEPORT', docSays: 'reusePort: two servers bind the same port (else EADDRINUSE)', evidencePath: 'deepPassGotchas.serve.reusePortTwoBind', kind: 'consistent' },
  { id: 'SV-ipv6Only', api: 'ipv6Only', source: 'serve.d.ts', fragment: 'IPV6_V6ONLY', docSays: 'ipv6Only: v6 reachable, v4 refused', evidencePath: 'deepPassGotchas.serve.ipv6Only.v4Fails', kind: 'consistent' },
  { id: 'SV-http1', api: 'http1', source: 'serve.d.ts', fragment: 'Listen for HTTP/1.1 over TCP', docSays: 'http1:false THROWS unless http3:true (enforced)', evidencePath: 'deepPassGotchas.serve.http1FalseThrows', kind: 'consistent' },
  { id: 'SV-idleTimeout', api: 'idleTimeout', source: 'serve.d.ts', fragment: 'Sets the number of seconds to wait before timing out', docSays: 'idleTimeout: 1s did NOT close idle conns within 4s on 1.4.0 (raw or keep-alive) - timer semantics unverified', evidencePath: 'deepPassGotchas.serve.idleTimeout1sNotClosedIn4s', kind: 'consistent' },
  { id: 'SV-unix', api: 'unix', source: 'serve.d.ts', fragment: 'unix?: string', docSays: 'unix: serve on a unix socket (connect + HTTP works)', evidencePath: 'deepPassGotchas.serve.unixWorks', kind: 'consistent' },
  { id: 'SQ-setCustomSQLite', api: 'setCustomSQLite', source: 'sqlite.d.ts', fragment: 'static setCustomSQLite(path: string): boolean', docSays: 'setCustomSQLite: first call returns true; after any Database it throws SQLite already loaded', evidencePath: 'deepPassGotchas.sqlite.setCustomSQLiteAfterDb', kind: 'consistent' },
  { id: 'SQ-fileControl', api: 'fileControl', source: 'sqlite.d.ts', fragment: 'fileControl(op: number', docSays: 'fileControl: returns 12 (SQLITE_NOTFOUND) for PERSIST_WAL + bogus ops on 1.4.0', evidencePath: 'deepPassGotchas.sqlite.fileControlPersistWalReturns', kind: 'consistent' },
  { id: 'SQ-loadExtension', api: 'loadExtension', source: 'sqlite.d.ts', fragment: 'loadExtension(extension: string, entryPoint?: string): void', docSays: 'loadExtension: REJECTS - the macOS system SQLite build does not support dynamic extensions', evidencePath: 'deepPassGotchas.sqlite.loadExtensionError', kind: 'consistent' },
  { id: 'MD-html', api: 'html', source: 'bun.d.ts', fragment: 'render to an HTML string', docSays: 'markdown.html: markdown -> HTML string', evidencePath: 'markdownGotchas.html', kind: 'consistent' },
  { id: 'MD-ansi', api: 'ansi', source: 'bun.d.ts', fragment: 'render to an ANSI-colored string', docSays: 'markdown.ansi: ANSI escapes; colors:false -> plain', evidencePath: 'markdownGotchas.ansiHasEscapes', kind: 'consistent' },
  { id: 'MD-render', api: 'render', source: 'bun.d.ts', fragment: 'render with custom callbacks', docSays: 'markdown.render: custom element callbacks', evidencePath: 'markdownGotchas.renderCallback', kind: 'consistent' },
  { id: 'MD-react', api: 'react', source: 'bun.d.ts', fragment: 'React-compatible JSX elements', docSays: 'markdown.react: React-element parse', evidencePath: 'markdownGotchas.reactParses', kind: 'consistent' },
  { id: 'MD-gfm', api: 'tables', source: 'bun.d.ts', fragment: 'GFM extensions (tables, strikethrough, task lists) are enabled', docSays: 'GFM (tables/strikethrough/tasklists) ON by default, per-feature toggles', evidencePath: 'markdownGotchas.gfm.tablesDefault', kind: 'consistent' },
  { id: 'MD-list', api: 'listItem', source: 'bun.d.ts', fragment: 'listItem?: (children: string, meta: ListItemMeta)', docSays: 'render callbacks: list/listItem with meta (checked/start/ordered)', evidencePath: 'markdownGotchas.renderContract.listItemChecked', kind: 'consistent' },
  { id: 'MD-meta', api: 'heading', source: 'bun.d.ts', fragment: 'Each callback receives the accumulated children', docSays: 'render callback contract: (children, meta) - meta is the metadata arg, NOT an element', evidencePath: 'markdownGotchas.renderContract.headingId', kind: 'consistent' },
  { id: 'MD-autolinks', api: 'autolinks', source: 'bun.d.ts', fragment: 'Enable autolinks. Pass `true` to enable all autolink types', docSays: 'autolinks OFF by default; { url: true } form works', evidencePath: 'markdownGotchas.options.autolinksDefaultOff', kind: 'consistent' },
  { id: 'MD-autolinksTrue', api: 'autolinks', source: 'bun.d.ts', fragment: 'Pass `true` to enable all autolink types', docSays: 'autolinks: true (boolean) enables url + www + email at once - verified', evidencePath: 'markdownGotchas.options.autolinksTrueAll', kind: 'consistent' },
  { id: 'MD-namedExport', api: 'markdown', source: 'bun.d.ts', fragment: 'This module aliases `globalThis.Bun`.', docSays: 'import { markdown } from "bun" is the SAME namespace object as Bun.markdown (module aliases globalThis.Bun); html/ansi/render/react all exposed', evidencePath: 'markdownGotchas.namedExport.identity', kind: 'consistent' },
  { id: 'MD-wikiLinks', api: 'wikiLinks', source: 'bun.d.ts', fragment: 'Enable wiki-style links', docSays: 'wikiLinks renders a custom x-wikilink element', evidencePath: 'markdownGotchas.options.wikiLinks', kind: 'consistent' },
  { id: 'MD-permissiveAtx', api: 'permissiveAtxHeaders', source: 'bun.d.ts', fragment: 'Allow ATX headers without a space after `#`', docSays: 'permissiveAtxHeaders honored; runtime default is OFF (matches types); true renders #header, false keeps it a paragraph', evidencePath: 'markdownGotchas.options.permissiveAtxTrueOn', kind: 'consistent' },
  { id: 'MD-callbacks', api: 'code', source: 'bun.d.ts', fragment: 'listItem?: (children: string, meta: ListItemMeta)', docSays: 'code/link/image/hr/blockquote callbacks receive (children, meta)', evidencePath: 'markdownGotchas.callbacks.codeLanguage', kind: 'consistent' },
  { id: 'MD-reactOverrides', api: 'react', source: 'bun.d.ts', fragment: 'Component overrides for `react()`.', docSays: 'react(): component overrides + reactVersion option work', evidencePath: 'markdownGotchas.reactOverrides.h1Override', kind: 'consistent' },
  { id: 'MD-ansiTheme', api: 'ansi', source: 'bun.d.ts', fragment: 'AnsiTheme', docSays: 'ansi(): columns/hyperlinks/kittyGraphics accepted; light no observed diff', evidencePath: 'markdownGotchas.ansiTheme.columnsWrap', kind: 'consistent' },
  { id: 'MD-noopOptions', api: 'latexMath', source: 'bun.d.ts', fragment: 'Enable LaTeX math', docSays: 'latexMath/underline/collapseWhitespace/hardSoftBreaks DECLARED but NO effect on 1.4.0 (plain newlines preserved; trailing-space <br> is CommonMark default, not the option)', evidencePath: 'markdownGotchas.notObservedToTakeEffect.latexMath', kind: 'consistent' },
  { id: 'MD-tagFilter', api: 'tagFilter', source: 'bun.d.ts', fragment: 'Enable the GFM tag filter', docSays: 'tagFilter: true escapes GFM-disallowed tags (script/style/iframe); allowed tags (table/div) untouched; function form ignored (type is boolean)', evidencePath: 'markdownGotchas.tagFilter.scriptEscaped', kind: 'consistent' },
  { id: 'MD-noHtmlBlocks', api: 'noHtmlBlocks', source: 'bun.d.ts', fragment: 'Disable HTML blocks', docSays: 'noHtmlBlocks: raw HTML block passthrough stops (block becomes a paragraph with inline HTML); with noHtmlSpans fully escaped', evidencePath: 'markdownGotchas.noHtmlBlocks.rawPassthroughStops', kind: 'consistent' },
  { id: 'MD-hardSoftBreaks', api: 'hardSoftBreaks', source: 'bun.d.ts', fragment: 'Treat soft line breaks as hard line breaks', docSays: 'hardSoftBreaks NO effect on 1.4.0: plain newline preserved in <p>; trailing-space <br> occurs without the option', evidencePath: 'markdownGotchas.notObservedToTakeEffect.hardSoftBreaks', kind: 'consistent' },
  { id: 'MD-reactProps', api: 'react', source: 'bun.d.ts', fragment: 'Custom components receive the same props', docSays: 'react overrides receive element props in the tree: h1 id, a href/title, pre language, li checked, ol start, th/td align, img src/title/alt (code key applies to INLINE code; fenced blocks are pre-only)', evidencePath: 'markdownGotchas.reactOverrides.propsFlow.h1Id', kind: 'consistent' },
  { id: 'MD-renderOmit', api: 'render', source: 'bun.d.ts', fragment: 'Return `null` or `undefined` to omit the element from the output', docSays: 'render callbacks: returning null/undefined omits the element (sole heading -> empty output)', evidencePath: 'markdownGotchas.callbacks.nullOmits', kind: 'consistent' },
  { id: 'MD-renderPassthrough', api: 'render', source: 'bun.d.ts', fragment: 'its children pass through unchanged', docSays: 'render: no callbacks -> children pass through (inline flattens to text; table keeps its source)', evidencePath: 'markdownGotchas.callbacks.noCallbacksPassthrough', kind: 'consistent' },
  { id: 'MD-listDepth', api: 'list', source: 'bun.d.ts', fragment: 'Nesting depth. `0` for a top-level list, `1` for a list inside a list item', docSays: 'render list meta depth verified: 0/1/2 for nested lists; hr callback receives empty children; ordered start from marker (3. -> 3); ul has no start', evidencePath: 'markdownGotchas.callbacks.nestedListDepths', kind: 'consistent' },
  { id: 'MD-inputTypes', api: 'html', source: 'bun.d.ts', fragment: 'NodeJS.TypedArray | DataView<ArrayBufferLike> | ArrayBufferLike', docSays: 'html/render/react accept TypedArray (Uint8Array) and ArrayBuffer inputs', evidencePath: 'markdownGotchas.inputs.typedArrayHtml', kind: 'consistent' },
  { id: 'GL-scan', api: 'scan', source: 'bun.d.ts', fragment: 'Scan a root directory recursively for files that match this glob pattern', docSays: 'Glob.scan/scanSync: cwd-scoped recursive scan (fixture *.ts -> a.ts; **/* -> a.ts,b.js,sub/c.txt)', evidencePath: 'utilityGotchas.glob.scanSyncAll', kind: 'consistent' },
  { id: 'GL-match', api: 'match', source: 'bun.d.ts', fragment: 'expect(glob.match', docSays: 'Glob.match: brace extension sets, no nested match without globstar, **/* matches nested paths', evidencePath: 'utilityGotchas.glob.matchGlobstar', kind: 'consistent' },
  { id: 'CH-digest', api: 'digest', source: 'bun.d.ts', fragment: 'The algorithm chosen to hash the data', docSays: 'CryptoHasher: sha256(abc) hex = ba7816bf... (known digest), md5(abc) = 90015098..., byteLength 32, algorithm prop', evidencePath: 'utilityGotchas.cryptoHasher.sha256Hex', kind: 'consistent' },
  { id: 'CH-staticHash', api: 'hash', source: 'bun.d.ts', fragment: 'Run the hash over the given data', docSays: 'CryptoHasher.hash(algorithm, input, encoding): static one-shot with hex encoding works', evidencePath: 'utilityGotchas.cryptoHasher.staticHashHex', kind: 'consistent' },
  { id: 'PW-hashVerify', api: 'password', source: 'bun.d.ts', fragment: 'Hash and verify passwords using argon2 or bcrypt', docSays: 'password.hash/verify: argon2id roundtrip works, wrong password false', evidencePath: 'utilityGotchas.password.argon2Verify', kind: 'consistent' },
  { id: 'PW-sync', api: 'password', source: 'bun.d.ts', fragment: 'Synchronously hash a password using argon2 or bcrypt', docSays: 'password.hashSync/verifySync: bcrypt roundtrip works; widely-known $2b$10$ "password" hash REJECTED (third-party bcrypt interop pin)', evidencePath: 'utilityGotchas.password.bcryptRoundtrip', kind: 'consistent' },
  { id: 'EH-escape', api: 'escapeHTML', source: 'bun.d.ts', fragment: 'function escapeHTML(input: string | object | number | boolean): string;', docSays: 'escapeHTML escapes < > & " (not single quotes)', evidencePath: 'utilityGotchas.escapeHTML.escapesTags', kind: 'consistent' },
  { id: 'DE-equal', api: 'deepEquals', source: 'bun.d.ts', fragment: 'This also powers expect().toEqual', docSays: 'deepEquals: NaN===NaN, Dates equal, -0 vs 0 FALSE, no == coercion (1 vs "1" false even loose)', evidencePath: 'utilityGotchas.deepEquals.nanEq', kind: 'consistent' },
  { id: 'WH-which', api: 'which', source: 'bun.d.ts', fragment: 'The path to the executable, or `null` if it isn\'t found', docSays: 'which("bun") resolves to the bun executable; unknown command -> null', evidencePath: 'miscGotchas.which.missingNull', kind: 'consistent' },
  { id: 'PK-peek', api: 'peek', source: 'bun.d.ts', fragment: 'Extract the value from the Promise in the same tick of the event loop', docSays: 'peek: settled promise -> value, plain value -> itself, pending -> same promise; peek.status reads pending/fulfilled/rejected', evidencePath: 'miscGotchas.peek.pendingIsSame', kind: 'consistent' },
  { id: 'SL-sleep', api: 'sleep', source: 'bun.d.ts', fragment: '`Bun.sleep` and the imported `sleep` function are interchangeable.', docSays: 'sleep(0) resolves; sleepSync blocks and returns undefined', evidencePath: 'miscGotchas.sleep.resolves', kind: 'consistent' },
  { id: 'NS-nanoseconds', api: 'nanoseconds', source: 'bun.d.ts', fragment: 'Nanoseconds since the process started', docSays: 'nanoseconds: positive number, monotonic within a process', evidencePath: 'miscGotchas.nanoseconds.monotonic', kind: 'consistent' },
  { id: 'TR-transform', api: 'transform', source: 'bun.d.ts', fragment: 'Transpile code from TypeScript or JSX into valid JavaScript.', docSays: 'Transpiler: explicit ts loader strips type annotations; jsx loader emits jsxDEV; DEFAULT loader is jsx (TS annotations throw without ts loader)', evidencePath: 'miscGotchas.transpiler.tsStrip', kind: 'consistent' },
  { id: 'TR-scanImports', api: 'scanImports', source: 'bun.d.ts', fragment: 'Get a list of import paths from a TypeScript, JSX, TSX, or JavaScript file.', docSays: 'scanImports returns [{kind:"import-statement",path}] entries', evidencePath: 'miscGotchas.transpiler.scanImports', kind: 'consistent' },
  { id: 'RS-resolveSync', api: 'resolveSync', source: 'bun.d.ts', fragment: 'function resolveSync(moduleId: string, parent: string): string;', docSays: 'resolveSync: node: builtins pass through; bare specifiers resolve to absolute paths', evidencePath: 'miscGotchas.resolveSync.nodePrefixPassthrough', kind: 'consistent' },
  { id: 'AR-write', api: 'write', source: 'bun.d.ts', fragment: 'Create an archive and write it to disk in one operation.', docSays: 'Archive.write is STATIC (path, data, options); writes a tarball to disk', evidencePath: 'archiveGotchas.staticWrite', kind: 'consistent' },
  { id: 'AR-blobBytes', api: 'blob', source: 'bun.d.ts', fragment: 'Create an `Archive` instance from input data.', docSays: 'new Archive(object) -> instance with blob()/bytes() (tarball buffers)', evidencePath: 'archiveGotchas.blobSize', kind: 'consistent' },
  { id: 'AR-extract', api: 'extract', source: 'bun.d.ts', fragment: 'Extract the archive contents to a directory on disk.', docSays: 'Archive.extract(dir, { glob }) returns the extracted entry count; glob filters (negative patterns exclude)', evidencePath: 'archiveGotchas.extractCount', kind: 'consistent' },
  { id: 'AR-compress', api: 'compress', source: 'bun.d.ts', fragment: 'By default, archives are not compressed. Use `{ compress: "gzip" }`', docSays: 'ArchiveOptions { compress: "gzip", level }: gzipped archive is smaller than the plain tarball', evidencePath: 'archiveGotchas.gzipSmaller', kind: 'consistent' },
  { id: 'AR-files', api: 'files', source: 'bun.d.ts', fragment: 'for (const [path, file] of entries)', docSays: 'Archive.files() returns a Map of path -> file; also accepts glob filters', evidencePath: 'archiveGotchas.filesIsMap', kind: 'consistent' },
  { id: 'UDP-create', api: 'udpSocket', source: 'bun.d.ts', fragment: 'Create a UDP socket', docSays: 'Bun.udpSocket(options) resolves to a udp.Socket; handler configured via options.socket.data', evidencePath: 'udpGotchas.loopbackEcho', kind: 'consistent' },
  { id: 'UDP-send', api: 'send', source: 'bun.d.ts', fragment: 'send(data: Data, port: number, address: string): boolean;', docSays: 'udp.Socket.send(data, port, address) - LOOPBACK ECHO verified (127.0.0.1 ping-42 round-trips); address getter {address,family,port}; close() sets closed=true', evidencePath: 'udpGotchas.loopbackEcho', kind: 'consistent' },
  { id: 'FI-surface', api: 'file', source: 'bun.d.ts', fragment: 'interface BunFile extends Blob', docSays: 'Bun.file(path) -> Blob-extending surface: name/size/type/lastModified/exists/text/json/arrayBuffer/stat/slice all verified', evidencePath: 'fileGotchas.text', kind: 'consistent' },
  { id: 'BW-write', api: 'write', source: 'bun.d.ts', fragment: 'A promise that resolves with the number of bytes written.', docSays: 'Bun.write(path|BunFile, data) returns the byte count; writing to a BunFile overwrites the file', evidencePath: 'fileGotchas.writeBytes', kind: 'consistent' },
  { id: 'XML-parse', api: 'parse', source: 'bun.d.ts', fragment: 'Parse an XML 1.0 document.', docSays: 'XML.parse: compact Document by default (root key -> attributes @name, child arrays, #text); tree shape with { compact: false }', evidencePath: 'xmlGotchas.parseCompact', kind: 'consistent' },
  { id: 'XML-stringify', api: 'stringify', source: 'bun.d.ts', fragment: 'The output is well-formed or', docSays: 'XML.stringify: round-trips parse(x) exactly, escapes & < >, Date scalar -> ISO, THROWS on malformed element names', evidencePath: 'xmlGotchas.roundtrip', kind: 'consistent' },
  { id: 'XML-compact', api: 'parse', source: 'bun.d.ts', fragment: '"@name"` — one per attribute', docSays: 'compact shape: attributes are "@name" keys, child names key elements, arrays for repeats, "#text" for own text', evidencePath: 'xmlGotchas.parseCompact', kind: 'consistent' },
  { id: 'XML-xxe', api: 'parse', source: 'docs/runtime/xml.mdx', fragment: 'so there is no XXE surface', docSays: 'XXE-safe: external DTDs/entities not read; a DOCTYPE/ENTITY document does NOT resolve the external entity', evidencePath: 'xmlGotchas.xxeUnresolved', kind: 'consistent' },
  { id: 'XML-import', api: 'parse', source: 'bun.d.ts', fragment: 'importing an `.xml` file evaluates to', docSays: 'importing a .xml file evaluates to the same compact Document shape as XML.parse', evidencePath: 'xmlGotchas.importEvalToCompact', kind: 'consistent' },
  { id: 'XML-bundler', api: 'parse', source: 'docs/runtime/xml.mdx', fragment: 'the bundler parses imported XML files at build time', docSays: 'Bun.build parses imported .xml files at build time and inlines them as JS objects (output contains the parsed data)', evidencePath: 'xmlGotchas.bundlerInlines', kind: 'consistent' },
  { id: 'XML-namedExport', api: 'XML', source: 'bun.d.ts', fragment: 'XML related APIs', docSays: 'Bun.XML and import { XML } from "bun" are the SAME namespace object; parse + stringify exposed', evidencePath: 'xmlGotchas.namedIdentity', kind: 'consistent' },
  { id: 'XML-perf', api: 'parse', source: 'docs/runtime/xml.mdx', fragment: '27 ms', docSays: 'performance: SIMD parse of a ~2 MB doc measured on this machine (docs claim 27 ms for 2.2 MB)', evidencePath: 'xmlGotchas.perf20kItemsMs', kind: 'consistent' },
  { id: 'BA-namingHash', api: 'naming', source: 'bun.d.ts', fragment: 'Set up custom naming patterns for all output types', docSays: 'naming { entry: "[name]-[hash].[ext]" } makes the ENTRY-POINT hash non-null (strong ETag source)', evidencePath: 'artifactGotchas.namingHash', kind: 'consistent' },
  { id: 'BA-sourcemapNested', api: 'sourcemap', source: 'bun.d.ts', fragment: 'sourcemap: BuildArtifact | null', docSays: 'BuildArtifact.sourcemap nests a BuildArtifact when sourcemap: "linked" (its hash is a 00000000 placeholder)', evidencePath: 'artifactGotchas.sourcemapLinked', kind: 'consistent' },
  { id: 'BA-sha256', api: 'SHA256', source: 'bun.d.ts', fragment: 'class SHA256 extends CryptoHashInterface', docSays: 'Bun.SHA256 exists; sha256("abc") hex matches the known digest (same as CryptoHasher sha256)', evidencePath: 'artifactGotchas.sha256Hex', kind: 'consistent' },
];

/** APIs with grounded evidence but no ledger row (fit/filter/quality/... come from the probe gates). */
export const EXTRA_GROUNDED: string[] = [
  'fit', 'filter', 'quality', 'lossless', 'compressionLevel', 'colors', 'dither',
  'brightness', 'saturation', 'placeholder', 'blob', 'bytes', 'buffer', 'text',
  'arrayBuffer', 'stream', 'json', 'slice', 'write', 'cwd', 'entrypoints', 'outdir',
  'format', 'splitting', 'loader', 'metafile', 'treeShaking', 'plugins',
  'tables', 'strikethrough', 'tasklists', 'paragraph', 'blockquote', 'code', 'hr', 'thead', 'tbody', 'tr', 'th', 'td', 'strong', 'emphasis', 'link', 'codespan', 'image', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'pre', 'em', 'a', 'img', 'del', 'math', 'u', 'br', 'reactVersion', 'autolinks', 'headings', 'wikiLinks', 'noIndentedCodeBlocks', 'noHtmlSpans', 'permissiveAtxHeaders', 'hardSoftBreaks', 'columns', 'hyperlinks', 'kittyGraphics', 'light', 'url', 'www', 'email', 'ids', 'autolink', 'start', 'index', 'depth', 'checked', 'align', 'language', 'href', 'title', 'src', 'alt', 'table', 'underline', 'collapseWhitespace', 'noHtmlBlocks', 'tagFilter',
  'tls', 'development', 'http3', 'runtime', 'importSource', 'factory',
  'prepare', 'get', 'all', 'values', 'exec', 'close', 'open', 'MAX_QUERY_CACHE_SIZE', 'file',
  'inTransaction', 'as', 'columnNames', 'columnTypes', 'paramsCount',
  'protocol', 'hostname', 'port', 'search', 'hash', 'username', 'password', 'groups',
  'parse', 'remove', 'type', 'scheduledTime', 'ref', 'unref', 'stop',
  'url', 'title', 'loading', 'onNavigated', 'onNavigationFailed', 'evaluate', 'screenshot', 'cdp', 'click', 'close', 'type', 'press', 'scroll',
  'name', 'size', 'type', 'lastModified', 'exists', 'stat', 'write', 'text', 'json', 'image', 'presign', 'unlink', 'delete', 'slice', 'arrayBuffer', 'file', 'bucket',
  'scrollTo', 'reload', 'resize', 'closeAll', 'addEventListener', 'list', 'forward', 'options',
  'scan', 'scanSync', 'match', 'update', 'copy', 'digest', 'byteLength', 'algorithm', 'hashSync', 'verify',
  'verifySync', 'escapeHTML', 'deepEquals', 'deepMatch',
  'which', 'peek', 'status', 'sleep', 'sleepSync', 'nanoseconds', 'resolveSync',
  'transform', 'transformSync', 'scanImports',
  'compress', 'level', 'extract', 'files', 'address', 'binaryType', 'closed', 'fd',
  'ref', 'reload', 'remoteAddress', 'send', 'sendMany', 'setBroadcast', 'setTTL', 'unref',
  'writer', 'exists', 'stat',
  'stringify', 'XML', 'sourcemap', 'path',
];

export function checkClaim(claim: LedgerClaim, sourceText: string, ev: Evidence): CheckResult {
  const docFound = sourceText.includes(claim.fragment);
  const observed = resolvePath(ev, claim.evidencePath);
  let verdict: Verdict;
  if (!docFound) verdict = 'DOC-CHANGED';
  else if (observed === undefined) verdict = 'NO-EVIDENCE';
  else verdict = claim.kind === 'discrepancy' ? 'PINNED-DISCREPANCY' : 'CONSISTENT';
  return { claim, verdict, docFound, observed };
}

export interface CoverageGap {
  surface: string;
  declared: string[];
  covered: string[];
  gaps: string[];
}

export function coverageGaps(declared: Record<string, string[]>, coveredNames: Set<string>): CoverageGap[] {
  return Object.entries(declared).map(([surface, names]) => {
    const gaps = names.filter((n) => !coveredNames.has(n));
    return { surface, declared: names, covered: names.filter((n) => coveredNames.has(n)), gaps };
  }).filter((g) => g.gaps.length > 0);
}

export {};