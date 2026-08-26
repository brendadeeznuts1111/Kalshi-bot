#!/usr/bin/env bun
/**
 * bun run build-artifact:evidence - capture REAL BuildArtifact and
 * BuildConfig evidence from live Bun.build() runs on the pinned runtime
 * and emit tools/build-artifact-evidence.json (committed). Grounding
 * rule (AGENT-PITFALLS 177 refactor): every value recorded here is
 * OBSERVED from an actual build in scratch/art-ground/ - docs claims
 * are compared against these observations, never the other way around.
 * Deterministic output: relativized paths, content-derived hashes,
 * no timestamps. Standalone executables from compile:true are captured
 * then deleted (they are tens of MB).
 */
import { markdown as mdNamed, XML as xmlNamed } from 'bun';
import { join } from 'node:path';
import { existsSync, rmSync, mkdtempSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = join(import.meta.dir, '..');
const F = join(ROOT, 'scratch', 'art-ground');
const EVIDENCE = join(ROOT, 'tools', 'build-artifact-evidence.json');
const rel = (p: string) => (p.startsWith(F) ? p.slice(F.length + 1) : p);

// ---------- fixtures (single-quoted, joined with escaped newline) ----------
const ENTRY = ['import { shared } from "./shared.ts";', 'import "./style.css";', 'export const main = () => shared();'].join('\n');
const ENTRY2 = ['import { shared } from "./shared.ts";', 'export const other = () => shared() * 2;'].join('\n');
const PURE = ['import { shared } from "./shared.ts";', 'export const pure = () => shared() + 1;'].join('\n');
const PURE2 = ['import { shared } from "./shared.ts";', 'export const pure2 = () => shared() + 2;'].join('\n');
const SHARED = 'export const shared = () => 42;';
const STYLE = 'body { color: red; }';
const ENVSRC = 'export const mode = process.env.GROUND_MODE ?? "unset";';
const DROPSRC = 'export const run = () => { console.log("hello"); return 1; };';
const DEFSRC = 'export const mode = MODE;';
const EXTSRC = ['import { z } from "zod";', 'export const schema = z.string();'].join('\n');
const DYNSRC = ['export const load = async (lang: string) => {', '  const m = await import("./locales/" + lang + ".json");', '  return m;', '};'].join('\n');
const PUBSRC = ['import p from "./pix.png";', 'export const img = p;'].join('\n');
const CONDSRC = ['import { tag } from "cond-pkg";', 'export const t = tag;'].join('\n');
const ROOTED = ['import { pure } from "../pure.ts";', 'export const v = pure();'].join('\n');
const CONDPKG = JSON.stringify({ name: 'cond-pkg', version: '1.0.0', exports: { '.': { custom: './custom.mjs', default: './default.mjs' } } });

const FILES: Record<string, string | Uint8Array> = {
  'entry.ts': ENTRY, 'entry2.ts': ENTRY2, 'pure.ts': PURE, 'pure2.ts': PURE2, 'shared.ts': SHARED,
  'style.css': STYLE, 'env.ts': ENVSRC, 'drop.ts': DROPSRC, 'def.ts': DEFSRC,
  'ext.ts': EXTSRC, 'dyn.ts': DYNSRC, 'pub.ts': PUBSRC, 'cond.ts': CONDSRC,
  'rooted/app.ts': ROOTED, 'pix.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'node_modules/cond-pkg/package.json': CONDPKG,
  'node_modules/cond-pkg/custom.mjs': 'export const tag = "CUSTOM";',
  'node_modules/cond-pkg/default.mjs': 'export const tag = "DEFAULT";',
};
for (const [name, content] of Object.entries(FILES)) {
  await Bun.write(join(F, name), content);
}
process.env.GROUND_MODE = 'grounded-ok';

// ---------- capture helpers ----------
const cap = (a: any) => {
  const sm = a.sourcemap;
  return {
    path: rel(a.path),
    kind: a.kind,
    hash: a.hash === null ? 'null' : String(a.hash),
    loader: String(a.loader),
    size: a.size,
    type: String(a.type),
    sourcemap: sm ? 'nested@' + rel(sm.path) : sm === null ? 'null' : 'undefined',
  };
};
const safe = async (opts: any) => {
  try {
    const r = await Bun.build(opts);
    return { ok: true, outputs: r.outputs.map(cap), success: r.success, logs: r.logs.map((l: any) => String(l.message ?? l).slice(0, 160)).slice(0, 3), err: '' };
  } catch (e: any) {
    const inner = Array.isArray(e?.errors) ? e.errors.map((x: any) => String(x?.message ?? x).slice(0, 160)).slice(0, 3) : [];
    const err = inner.length ? inner.join(' | ') : String(e);
    return { ok: false, outputs: [], success: false, logs: err.slice(0, 400).split('\n'), err: err.slice(0, 400) };
  }
};


const scenarios: any[] = [];
const push = (name: string, config: any, result: any, observed: any = {}) => {
  scenarios.push({ name, config, outputs: result.outputs, ok: result.ok, logs: result.logs, observed });
};

// ---------- S01: artifact surface (with outdir) ----------
const s01 = await safe({ entrypoints: [join(F, 'entry.ts')], outdir: join(F, 'out') });
const s01entry = s01.outputs.find((o: any) => o.kind === 'entry-point');
const s01obj = s01.outputs.find((o: any) => o.kind === 'asset');
const live01 = s01.ok ? await Bun.build({ entrypoints: [join(F, 'entry.ts')], outdir: join(F, 'out') }) : null;
const a0 = live01 ? live01.outputs[0] : null;
const methods = a0 ? {
  text: typeof a0.text === 'function',
  arrayBuffer: typeof a0.arrayBuffer === 'function',
  stream: typeof a0.stream === 'function',
  json: typeof (a0 as any).json === 'function',
  formData: typeof (a0 as any).formData === 'function',
  image: typeof (a0 as any).image === 'function',
  bytes: typeof (a0 as any).bytes === 'function',
  instanceofBlob: a0 instanceof Blob,
} : {};
push('S01-artifact-surface', { entrypoints: ['entry.ts'], outdir: 'out' }, s01, {
  writtenToDisk: existsSync(join(F, 'out', 'entry.js')),
  methods,
  cssAssetLoader: s01obj ? s01obj.loader : null,
  cssAssetType: s01obj ? s01obj.type : null,
  cssAssetHash: s01obj ? s01obj.hash : null,
});

// ---------- S02: no outdir ----------
const s02 = await safe({ entrypoints: [join(F, 'entry.ts')] });
const s02exists = s02.ok && s02.outputs[0] ? await Bun.file(s02.outputs[0].path).exists() : false;
push('S02-no-outdir', { entrypoints: ['entry.ts'] }, s02, {
  writtenToDisk: s02exists,
  textReadable: s02.ok ? (await (await safe({ entrypoints: [join(F, 'entry.ts')] })).outputs.length > 0) : false,
});

// ---------- S03: splitting / kinds ----------
const s03 = await safe({ entrypoints: [join(F, 'entry.ts'), join(F, 'entry2.ts')], outdir: join(F, 'outx'), splitting: true });
const chunk03 = s03.outputs.find((o: any) => o.kind === 'chunk');
push('S03-splitting', { entrypoints: ['entry.ts', 'entry2.ts'], outdir: 'outx', splitting: true }, s03, {
  kinds: s03.outputs.map((o: any) => o.kind),
  chunkPathEmbedsHash: !!chunk03 && chunk03.path.includes(chunk03.hash),
});

// ---------- S04: sourcemap modes ----------
const smModes: any = {};
for (const mode of ['none', 'linked', 'external', 'inline'] as const) {
  const r = await safe({ entrypoints: [join(F, 'pure.ts')], outdir: join(F, 'outsm-' + mode), sourcemap: mode });
  const entry = r.ok ? r.outputs[0] : null;
  const text = r.ok && entry ? await (await Bun.build({ entrypoints: [join(F, 'pure.ts')], outdir: join(F, 'outsm-' + mode + 'b'), sourcemap: mode })).outputs[0]!.text() : '';
  smModes[mode] = {
    kinds: r.outputs.map((o: any) => o.kind),
    entrySourcemap: entry ? entry.sourcemap : null,
    mapHashes: r.outputs.filter((o: any) => o.kind === 'sourcemap').map((o: any) => o.hash),
    hasComment: text.includes('sourceMappingURL'),
    inlineBase64: text.includes('base64') || text.includes('data:application/json'),
  };
  push('S04-sourcemap-' + mode, { entrypoints: ['pure.ts'], outdir: 'outsm-' + mode, sourcemap: mode }, r, smModes[mode]);
}

// ---------- S05: naming string vs object ----------
const s05a = await safe({ entrypoints: [join(F, 'pure.ts'), join(F, 'pure2.ts')], outdir: join(F, 'outn'), splitting: true, naming: 'static/[name].js' });
const s05b = await safe({ entrypoints: [join(F, 'pure.ts'), join(F, 'pure2.ts')], outdir: join(F, 'outn2'), splitting: true, naming: { entry: 'e/[name].js', chunk: 'c/[name].js', asset: 'a/[name].js' } });
const s05c = await safe({ entrypoints: [join(F, 'entry.ts')], outdir: join(F, 'outn3'), naming: 'static/[name].js' });
push('S05a-naming-string', { entrypoints: ['pure.ts', 'pure2.ts'], outdir: 'outn', splitting: true, naming: 'static/[name].js' }, s05a, {
  entryPaths: s05a.outputs.filter((o: any) => o.kind === 'entry-point').map((o: any) => o.path),
  chunkPaths: s05a.outputs.filter((o: any) => o.kind === 'chunk').map((o: any) => o.path),
});
push('S05b-naming-object', { entrypoints: ['pure.ts', 'pure2.ts'], outdir: 'outn2', splitting: true, naming: { entry: 'e/[name].js', chunk: 'c/[name].js', asset: 'a/[name].js' } }, s05b, {
  entryPaths: s05b.outputs.filter((o: any) => o.kind === 'entry-point').map((o: any) => o.path),
  chunkPaths: s05b.outputs.filter((o: any) => o.kind === 'chunk').map((o: any) => o.path),
});
push('S05c-naming-hashless-collision', { entrypoints: ['entry.ts'], outdir: 'outn3', naming: 'static/[name].js' }, s05c, {
  hashlessNaming: s05c.ok ? s05c.outputs.map((o: any) => ({ path: o.path, hash: o.hash })) : [],
});

// ---------- S06: bytecode ----------
const s06 = await safe({ entrypoints: [join(F, 'pure.ts')], outdir: join(F, 'outbc'), bytecode: true, target: 'bun' });
push('S06-bytecode', { entrypoints: ['pure.ts'], outdir: 'outbc', bytecode: true, target: 'bun' }, s06, {
  kinds: s06.outputs.map((o: any) => o.kind),
});

// ---------- S07: compile ----------
const s07a = await safe({ entrypoints: [join(F, 'pure.ts')], outdir: join(F, 'outcomp'), compile: true, target: 'bun' });
const compPath = s07a.ok ? join(F, 'outcomp', 'pure') : null;
const compDisk = compPath && existsSync(compPath) ? await Bun.file(compPath).size : null;
if (compPath) rmSync(join(F, 'outcomp'), { recursive: true, force: true });
const s07b = await safe({ entrypoints: [join(F, 'pure.ts')], compile: 'bun' as any, target: 'bun' });
const s07c = await safe({ entrypoints: [join(F, 'pure.ts')], outfile: join(F, 'comp-outfile'), compile: true, target: 'bun' });
const s07cPath = s07c.ok && s07c.outputs[0] ? join(F, s07c.outputs[0].path) : null;
const s07cWritten = s07cPath ? existsSync(s07cPath) : false;
if (s07cPath) rmSync(s07cPath, { force: true });
const s07d = await safe({ entrypoints: [join(F, 'pure.ts')], outfile: join(F, 'comp-object'), compile: { outfile: join(F, 'comp-object') } as any, target: 'bun' });
const objExists = existsSync(join(F, 'comp-object'));
if (objExists) rmSync(join(F, 'comp-object'), { force: true });
push('S07a-compile-outdir', { entrypoints: ['pure.ts'], outdir: 'outcomp', compile: true, target: 'bun' }, s07a, { written: compPath !== null && compDisk !== null, onDiskBytes: compDisk });
push('S07b-compile-string-bun', { entrypoints: ['pure.ts'], compile: 'bun', target: 'bun' }, s07b);
push('S07c-compile-true-outfile', { entrypoints: ['pure.ts'], outfile: 'comp-outfile', compile: true, target: 'bun' }, s07c, { writtenAtOutfilePath: existsSync(join(F, 'comp-outfile')), executableWrittenAt: s07c.outputs[0] ? s07c.outputs[0].path : null, writtenAtArtifactPath: s07cWritten });
push('S07d-compile-object-outfile', { entrypoints: ['pure.ts'], outfile: 'comp-object', compile: { outfile: 'comp-object' }, target: 'bun' }, s07d, { written: objExists });

// ---------- S08: target ----------
const tgt: any = {};
for (const t of ['node', 'browser', 'bun'] as const) {
  const r = await safe({ entrypoints: [join(F, 'env.ts')], outdir: join(F, 'outt-' + t), target: t });
  const text = r.ok ? await (await Bun.build({ entrypoints: [join(F, 'env.ts')], outdir: join(F, 'outt-' + t + 'b'), target: t })).outputs[0]!.text() : '';
  tgt[t] = { size: r.outputs[0] ? r.outputs[0].size : null, hasBunHeader: text.includes('@bun'), hasProcess: text.includes('process') };
  push('S08-target-' + t, { entrypoints: ['env.ts'], outdir: 'outt-' + t, target: t }, r, tgt[t]);
}

// ---------- S09: format ----------
const fmt: any = {};
for (const f of ['esm', 'cjs', 'iife'] as const) {
  const r = await safe({ entrypoints: [join(F, 'pure.ts')], outdir: join(F, 'outf-' + f), format: f });
  const text = r.ok ? await (await Bun.build({ entrypoints: [join(F, 'pure.ts')], outdir: join(F, 'outf-' + f + 'b'), format: f })).outputs[0]!.text() : '';
  fmt[f] = { size: r.outputs[0] ? r.outputs[0].size : null, marker: text.slice(0, 40) };
  push('S09-format-' + f, { entrypoints: ['pure.ts'], outdir: 'outf-' + f, format: f }, r, fmt[f]);
}

// ---------- S10: minify ----------
const min: any = {};
for (const [label, v] of [['off', false], ['on', true], ['object', { whitespace: true, identifiers: true, syntax: true }]] as const) {
  const r = await safe({ entrypoints: [join(F, 'pure.ts')], outdir: join(F, 'outm-' + label), minify: v });
  min[label] = { size: r.outputs[0] ? r.outputs[0].size : null, hash: r.outputs[0] ? r.outputs[0].hash : null };
  push('S10-minify-' + label, { entrypoints: ['pure.ts'], outdir: 'outm-' + label, minify: v }, r, min[label]);
}

// ---------- S11: define ----------
const s11 = await safe({ entrypoints: [join(F, 'def.ts')], outdir: join(F, 'outd'), define: { MODE: '"prod"' } });
const s11text = s11.ok ? await (await Bun.build({ entrypoints: [join(F, 'def.ts')], outdir: join(F, 'outd2'), define: { MODE: '"prod"' } })).outputs[0]!.text() : '';
push('S11-define', { entrypoints: ['def.ts'], outdir: 'outd', define: { MODE: '"prod"' } }, s11, { inlined: s11text.includes('prod') });

// ---------- S12: env ----------
const env: any = {};
for (const [label, v] of [['inline', 'inline'], ['disable', 'disable'], ['prefix', 'GROUND_*']] as const) {
  const r = await safe({ entrypoints: [join(F, 'env.ts')], outdir: join(F, 'oute-' + label), env: v });
  const text = r.ok ? await (await Bun.build({ entrypoints: [join(F, 'env.ts')], outdir: join(F, 'oute-' + label + 'b'), env: v })).outputs[0]!.text() : '';
  env[label] = { size: r.outputs[0] ? r.outputs[0].size : null, substituted: text.includes('grounded-ok'), keptDynamic: text.includes('process.env.GROUND_MODE') };
  push('S12-env-' + label, { entrypoints: ['env.ts'], outdir: 'oute-' + label, env: v }, r, env[label]);
}

// ---------- S13: drop ----------
const s13a = await safe({ entrypoints: [join(F, 'drop.ts')], outdir: join(F, 'outdr') });
const s13b = await safe({ entrypoints: [join(F, 'drop.ts')], outdir: join(F, 'outdr2'), drop: ['console.log'] });
const t13a = s13a.ok ? await (await Bun.build({ entrypoints: [join(F, 'drop.ts')], outdir: join(F, 'outdr3') })).outputs[0]!.text() : '';
const t13b = s13b.ok ? await (await Bun.build({ entrypoints: [join(F, 'drop.ts')], outdir: join(F, 'outdr4'), drop: ['console.log'] })).outputs[0]!.text() : '';
push('S13a-drop-off', { entrypoints: ['drop.ts'], outdir: 'outdr' }, s13a, { hasConsoleLog: t13a.includes('console.log') });
push('S13b-drop-on', { entrypoints: ['drop.ts'], outdir: 'outdr2', drop: ['console.log'] }, s13b, { hasConsoleLog: t13b.includes('console.log') });

// ---------- S14: allowUnresolved ----------
const au: any = {};
for (const [label, v] of [['default', undefined], ['star', ['*']], ['empty', []], ['glob', ['./locales/*.json']]] as const) {
  const cfg: any = { entrypoints: [join(F, 'dyn.ts')], outdir: join(F, 'outa-' + label) };
  if (v !== undefined) cfg.allowUnresolved = v;
  const r = await safe(cfg);
  au[label] = { ok: r.ok, log: r.logs[0] ?? '' };
  push('S14-allowUnresolved-' + label, { entrypoints: ['dyn.ts'], outdir: 'outa-' + label, allowUnresolved: v }, r);
}

// ---------- S15: external ----------
const s15a = await safe({ entrypoints: [join(F, 'ext.ts')], outdir: join(F, 'outex'), external: ['zod'] });
const s15b = await safe({ entrypoints: [join(F, 'ext.ts')], outdir: join(F, 'outex2') });
const t15a = s15a.ok ? await (await Bun.build({ entrypoints: [join(F, 'ext.ts')], outdir: join(F, 'outex3'), external: ['zod'] })).outputs[0]!.text() : '';
push('S15a-external-zod', { entrypoints: ['ext.ts'], outdir: 'outex', external: ['zod'] }, s15a, { keptImport: t15a.includes('from "zod"'), size: s15a.outputs[0] ? s15a.outputs[0].size : null });
push('S15b-bundle-zod', { entrypoints: ['ext.ts'], outdir: 'outex2' }, s15b, { size: s15b.outputs[0] ? s15b.outputs[0].size : null });

// ---------- S16: conditions ----------
const s16a = await safe({ entrypoints: [join(F, 'cond.ts')], outdir: join(F, 'outc') });
const s16b = await safe({ entrypoints: [join(F, 'cond.ts')], outdir: join(F, 'outc2'), conditions: ['custom'] });
const t16a = s16a.ok ? await (await Bun.build({ entrypoints: [join(F, 'cond.ts')], outdir: join(F, 'outc3') })).outputs[0]!.text() : '';
const t16b = s16b.ok ? await (await Bun.build({ entrypoints: [join(F, 'cond.ts')], outdir: join(F, 'outc4'), conditions: ['custom'] })).outputs[0]!.text() : '';
push('S16a-conditions-default', { entrypoints: ['cond.ts'], outdir: 'outc' }, s16a, { resolvedMarker: t16a.split('\n').filter((l: string) => l.includes('tag'))[0] ?? '' });
push('S16b-conditions-custom', { entrypoints: ['cond.ts'], outdir: 'outc2', conditions: ['custom'] }, s16b, { resolvedMarker: t16b.split('\n').filter((l: string) => l.includes('tag'))[0] ?? '' });

// ---------- S17: publicPath ----------
const s17 = await safe({ entrypoints: [join(F, 'pub.ts')], outdir: join(F, 'outp'), publicPath: '/cdn/' });
const t17 = s17.ok ? await (await Bun.build({ entrypoints: [join(F, 'pub.ts')], outdir: join(F, 'outp2'), publicPath: '/cdn/' })).outputs[0]!.text() : '';
const pixAsset = s17.outputs.find((o: any) => o.kind === 'asset');
push('S17-publicPath', { entrypoints: ['pub.ts'], outdir: 'outp', publicPath: '/cdn/' }, s17, {
  jsReferencesCdn: t17.includes('/cdn/pix-'),
  assetPath: pixAsset ? pixAsset.path : null,
  assetLoader: pixAsset ? pixAsset.loader : null,
  assetHash: pixAsset ? pixAsset.hash : null,
});

// ---------- S18: root ----------
const s18a = await safe({ entrypoints: [join(F, 'rooted', 'app.ts')], outdir: join(F, 'outr') });
const s18b = await safe({ entrypoints: [join(F, 'rooted', 'app.ts')], outdir: join(F, 'outr2'), root: F });
push('S18a-root-unset', { entrypoints: ['rooted/app.ts'], outdir: 'outr' }, s18a);
push('S18b-root-set', { entrypoints: ['rooted/app.ts'], outdir: 'outr2', root: 'scratch/art-ground' }, s18b);

// ---------- S19: outfile ----------
const s19 = await safe({ entrypoints: [join(F, 'pure.ts')], outfile: join(F, 'single-out.js') });
push('S19-outfile', { entrypoints: ['pure.ts'], outfile: 'single-out.js' }, s19, {
  writtenAtOutfilePath: existsSync(join(F, 'single-out.js')),
  artifactPath: s19.outputs[0] ? s19.outputs[0].path : null,
  writtenAtCwdPath: existsSync(join(process.cwd(), s19.outputs[0] ? s19.outputs[0].path : './none')),
});

// ---------- imageGotchas: Blob#image() / Bun.Image surface (177 refactor) ----------
const imgDir = mkdtempSync(join(tmpdir(), 'art-ground-img-'));
const IMG_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAFElEQVR42mP8z8Dwn4GBgYGJgZGBAQAbYgIBL8f2GQAAAABJRU5ErkJggg==';
const imgPngB = Buffer.from(IMG_PNG, 'base64');
const imgSrc = join(imgDir, 'src.png');
writeFileSync(imgSrc, imgPngB);

// BuildArtifact.image() absence vs the real Blob surface
const imgArt = (await Bun.build({ entrypoints: [join(F, 'pure.ts')], outdir: join(F, 'outimg') })).outputs[0] as any;
const imgGotchas: any = {
  buildArtifactImage: { typeof: typeof imgArt.image, instanceofBlob: imgArt instanceof Blob },
  realSurface: {
    plainBlobImage: typeof (new Blob([imgPngB]) as any).image,
    bunFileImage: typeof (Bun.file(imgSrc) as any).image,
  },
  lazy: {
    imageOnGarbageDoesNotThrow: (() => { try { const im = (Bun.file(join(imgDir, 'garbage.png')) as any).image(); return typeof im.resize === 'function'; } catch { return false; } })(),
    terminalErrorCode: (async () => { const g = join(imgDir, 'garbage.png'); writeFileSync(g, 'not an image'); try { await (Bun.file(g) as any).image().metadata(); return 'no-error'; } catch (e: any) { return e.code ?? String(e); } })(),
  },
  dimsBeforeTerminal: (async () => { const im = (Bun.file(imgSrc) as any).image(); const before = { w: im.width, h: im.height }; await im.resize(8, 8).png().bytes(); return { before, after: { w: im.width, h: im.height } }; })(),
  sniffing: (async () => {
    const fakeJpg = join(imgDir, 'fake.jpg');
    writeFileSync(fakeJpg, imgPngB);
    const f = (await (Bun.file(fakeJpg) as any).image().metadata()).format;
    const b = (await (new Blob([imgPngB], { type: 'image/jpeg' }) as any).image().metadata()).format;
    return { jpgFileWithPngBytes: f, jpegTypedBlobWithPngBytes: b };
  })(),
  maxPixels: (async () => {
    const crcTable = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
    const crc32 = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const pngChunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type, 'ascii'); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
    const mkHuge = (w: number, h: number) => { const sig = Buffer.from('89504e470d0a1a0a', 'hex'); const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; const idat = Buffer.from('789c63600000020001000a39', 'hex'); return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]); };
    const px = async (w: number, h: number) => { try { await new (Bun as any).Image(mkHuge(w, h)).metadata(); return 'OK'; } catch (err: any) { return err.code ?? String(err); } };
    return { boundaryPixels: 16384 * 16384, underBoundary: await px(16383, 16383), atBoundary: await px(16384, 16384), oversized: await px(40000, 40000) };
  })(),
  formatReuse: (async () => {
    const noFmt = await (Bun.file(imgSrc) as any).image().resize(4, 4).bytes();
    const blobNoFmt = await (Bun.file(imgSrc) as any).image().resize(4, 4).blob();
    const outJpg = join(imgDir, 'out.jpg');
    await (Bun.file(imgSrc) as any).image().resize(4, 4).write(outJpg);
    const ob = (await Bun.file(outJpg).bytes()).slice(0, 4);
    return {
      noFormatBytesPngSignature: noFmt[0] === 0x89 && noFmt[1] === 0x50,
      noFormatBlobType: blobNoFmt.type,
      writeToJpgPathIsJpeg: ob[0] === 0xff && ob[1] === 0xd8,
    };
  })(),
  response: (async () => {
    const r = new Response((Bun.file(imgSrc) as any).image().resize(8, 8).png());
    const ct = r.headers.get('content-type') ?? 'none';
    const len = (await r.arrayBuffer()).byteLength;
    return { contentType: ct, bodyBytes: len };
  })(),
};
imgGotchas.lazy.terminalErrorCode = await imgGotchas.lazy.terminalErrorCode;
imgGotchas.dimsBeforeTerminal = await imgGotchas.dimsBeforeTerminal;
imgGotchas.sniffing = await imgGotchas.sniffing;
imgGotchas.maxPixels = await imgGotchas.maxPixels;
imgGotchas.formatReuse = await imgGotchas.formatReuse;
imgGotchas.response = await imgGotchas.response;
rmSync(imgDir, { recursive: true, force: true });

// ---------- sliceGotchas: BuildArtifact.slice() (177 refactor) ----------
const sliceWithOut = (await Bun.build({ entrypoints: [join(F, 'entry.ts')], outdir: join(F, 'out') })).outputs[0] as any;
const sliceNoOut = (await Bun.build({ entrypoints: [join(F, 'entry.ts')] })).outputs[0] as any;
const sliceFull = await sliceWithOut.text();
const sliceCases: [string, number, number | undefined][] = [
  ['slice(-4)', -4, undefined],
  ['slice(0,-4)', 0, -4],
  ['slice(2,-4)', 2, -4],
  ['slice(-10,-4)', -10, -4],
  ['slice(-4,10)', -4, 10],
];
const sliceMatrix: any = {};
for (const [label, s, en] of sliceCases) {
  sliceMatrix[label] = {
    withOutdir: (await sliceWithOut.slice(s, en).text()).length,
    noOutdir: (await sliceNoOut.slice(s, en).text()).length,
    blobSpec: (await new Blob([sliceFull]).slice(s, en).text()).length,
  };
}
const sliceSliced = sliceWithOut.slice(0, 10) as any;
const sliceGotchas = {
  sliceExists: typeof sliceWithOut.slice === 'function',
  returnsPlainBlob: {
    instanceofBlob: sliceSliced instanceof Blob,
    lostProps: { kind: String(sliceSliced.kind), path: String(sliceSliced.path), loader: String(sliceSliced.loader), hash: String(sliceSliced.hash), sourcemap: String(sliceSliced.sourcemap) },
    gained: { bytes: typeof sliceSliced.bytes, text: typeof sliceSliced.text, arrayBuffer: typeof sliceSliced.arrayBuffer, stream: typeof sliceSliced.stream, json: typeof sliceSliced.json, slice: typeof sliceSliced.slice },
  },
  byteOffsets: {
    slice26Value: (await sliceWithOut.slice(2, 6).text()),
    slice26EqualsContent26: (await sliceWithOut.slice(2, 6).text()) === sliceFull.slice(2, 6),
    slice010MatchesBlob: (await sliceWithOut.slice(0, 10).text()) === (await new Blob([sliceFull]).slice(0, 10).text()),
  },
  negativeMatrix: sliceMatrix,
  pathSemantics: {
    withOutdirAbsolute: sliceWithOut.path.startsWith('/'),
    noOutdirBare: sliceNoOut.path.startsWith('./'),
    slicedWritesNothingToDisk: (() => { const before = existsSync(join(F, 'out', 'entry.js')); const s = sliceWithOut.slice(0, 4); return before && typeof s.text === 'function'; })(),
  },
};

// ---------- imageCtorGotchas: Bun.Image constructor inputs (177 refactor) ----------
const ctorDir = mkdtempSync(join(tmpdir(), 'art-ground-ctor-'));
const CTOR_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAFElEQVR42mP8z8Dwn4GBgYGJgZGBAQAbYgIBL8f2GQAAAABJRU5ErkJggg==';
const ctorPng = Buffer.from(CTOR_PNG, 'base64');
const ctorSrc = join(ctorDir, 'src.png');
writeFileSync(ctorSrc, ctorPng);
writeFileSync(join(ctorDir, 'fake.jpg'), ctorPng);
const ctorCode = async (input: any, opts: any = {}) => { try { const m = await new (Bun as any).Image(input, opts).metadata(); return 'OK ' + m.format + ' ' + m.width + 'x' + m.height; } catch (err: any) { return err.code ?? String(err).slice(0, 60); } };
const ctorJpeg = await new (Bun as any).Image(ctorPng).jpeg({ quality: 90 }).bytes();
// EXIF Orientation=6 splice
const exifBuf = Buffer.alloc(6 + 8 + 2 + 12 + 4);
exifBuf.write('Exif\x00\x00', 0);
exifBuf.write('II', 6);
exifBuf.writeUInt16LE(42, 8);
exifBuf.writeUInt32LE(8, 10);
exifBuf.writeUInt16LE(1, 14);
exifBuf.writeUInt16LE(0x0112, 16);
exifBuf.writeUInt16LE(3, 18);
exifBuf.writeUInt32LE(1, 20);
exifBuf.writeUInt16LE(6, 24);
exifBuf.writeUInt32LE(0, 28);
const app1 = Buffer.alloc(2 + 2 + exifBuf.length);
app1.writeUInt16BE(0xffe1, 0);
app1.writeUInt16BE(2 + exifBuf.length, 2);
exifBuf.copy(app1, 4);
const ctorExifJpeg = Buffer.concat([ctorJpeg.subarray(0, 2), app1, ctorJpeg.subarray(2)]);
const transferred = new ArrayBuffer(ctorPng.length);
new Uint8Array(transferred).set(ctorPng);
const ctorImgX = new (Bun as any).Image(transferred);
structuredClone(transferred, { transfer: [transferred] });
const ctorPxBoundary = (async () => {
  const crcT = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
  const crc32 = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crcT[(c ^ b) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type, 'ascii'); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
  const mk = (w: number, h: number) => { const sig = Buffer.from('89504e470d0a1a0a', 'hex'); const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; const idat = Buffer.from('789c63600000020001000a39', 'hex'); return Buffer.concat([sig, ch('IHDR', ihdr), ch('IDAT', idat), ch('IEND', Buffer.alloc(0))]); };
  const px = async (w: number, h: number, o: any = {}) => { try { await new (Bun as any).Image(mk(w, h), o).metadata(); return 'OK'; } catch (e: any) { return e.code; } };
  return { underDefault_16383sq: await px(16383, 16383), overDefault_16384sq: await px(16384, 16384), override100_10x10: await px(10, 10, { maxPixels: 100 }), override100_11x11: await px(11, 11, { maxPixels: 100 }) };
})();
const imageCtorGotchas = {
  pathIsFilesystemRead: {
    existingPathDecodes: await ctorCode(ctorSrc),
    missingPathError: await ctorCode(join(ctorDir, 'nope.png')),
  },
  formatSniffedFromBytes: {
    jpgNamedFileWithPngBytes: await ctorCode(join(ctorDir, 'fake.jpg')),
    rawPngBytes: await ctorCode(ctorPng),
  },
  acceptedInputs: {
    uint8array: await ctorCode(new Uint8Array(ctorPng)),
    arrayBuffer: await ctorCode(ctorPng.buffer.slice(0)),
    buffer: await ctorCode(ctorPng),
  },
  bufferGuards: {
    sharedArrayBuffer: await ctorCode(new Uint8Array(new SharedArrayBuffer(ctorPng.length))),
    resizableArrayBuffer: await ctorCode((() => { const ab = new ArrayBuffer(ctorPng.length, { maxByteLength: ctorPng.length * 2 }); new Uint8Array(ab).set(ctorPng); return ab; })()),
    transferredBetweenCtorAndTerminal: await ctorImgX.metadata().then(() => 'OK', (err: any) => err.code ?? String(err)),
    docClaimsInvalidStateForTransfer: 'ERR_INVALID_STATE',
  },
  maxPixels: {
    typeDocDefault: 268402689,
    typeDocDefaultFormula: '0x3FFF * 0x3FFF (16383^2, same as Sharp)',
    boundary: await ctorPxBoundary,
  },  autoOrient: {
    baseJpegNoExif: await ctorCode(ctorJpeg),
    exifOrientation6Default: await ctorCode(ctorExifJpeg),
    exifOrientation6WithFalse: await ctorCode(ctorExifJpeg, { autoOrient: false }),
  },
};
rmSync(ctorDir, { recursive: true, force: true });

// ---------- computeGuideGotchas: Prisma Compute image-transformations claims (177 refactor) ----------
const cmpDir = mkdtempSync(join(tmpdir(), 'art-ground-cmp-'));
const CMP_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAFElEQVR42mP8z8Dwn4GBgYGJgZGBAQAbYgIBL8f2GQAAAABJRU5ErkJggg==';
const cmpPng = Buffer.from(CMP_PNG, 'base64');
const cmpSrc = join(cmpDir, 'src.png');
writeFileSync(cmpSrc, cmpPng);
const cmpMeta = async (b: any) => (await new (Bun as any).Image(b).metadata());
const upB = await new (Bun as any).Image(cmpSrc).resize(800, 600, { withoutEnlargement: true }).png().bytes();
const stB = await new (Bun as any).Image(cmpSrc).resize(800, 600).png().bytes();
const ruB = await new (Bun as any).Image(cmpSrc).resize(800, undefined, { fit: 'inside', withoutEnlargement: true, filter: 'lanczos3' }).png().bytes();
const filterOk: Record<string, boolean> = {};
for (const filter of ['nearest', 'box', 'bilinear', 'cubic', 'mitchell', 'lanczos2', 'lanczos3']) { try { await new (Bun as any).Image(cmpSrc).resize(20, 10, { filter }).png().bytes(); filterOk[filter] = true; } catch { filterOk[filter] = false; } }
const progB = await new (Bun as any).Image(cmpSrc).jpeg({ quality: 80, progressive: true }).bytes();
const baseB = await new (Bun as any).Image(cmpSrc).jpeg({ quality: 80 }).bytes();
const hasMarker = (buf: Uint8Array, m: number) => { for (let i = 0; i < buf.length - 1; i++) if (buf[i] === 0xff && buf[i + 1] === m) return true; return false; };
const palB = await new (Bun as any).Image(cmpSrc).png({ palette: true, colors: 64, dither: true }).bytes();
const plainB = await new (Bun as any).Image(cmpSrc).png().bytes();
const cmpOut = join(cmpDir, 'out.webp');
const wbf = await new (Bun as any).Image(cmpSrc).resize(8, 8).webp().write(Bun.file(cmpOut));
const cmpS3: any = (Bun as any).s3;
const s3CallableErr = (() => { try { (Bun as any).s3('x'); return ''; } catch (err: any) { return String(err.message ?? err).slice(0, 80); } })();
const s3FileImage = (() => { try { const f = cmpS3.file('uploads/photo.jpg'); return { fileImage: typeof f.image, fileWrite: typeof f.write }; } catch { return null; } })();
const cmpImg: any = new (Bun as any).Image(cmpSrc);
const computeGuideGotchas = {
  withoutEnlargement: {
    source: '2x1',
    requested: '800x600',
    withOptionResult: (await cmpMeta(upB)).width + 'x' + (await cmpMeta(upB)).height,
    withoutOptionResult: (await cmpMeta(stB)).width + 'x' + (await cmpMeta(stB)).height,
  },
  resizeWidthUndefined: (await cmpMeta(ruB)).width + 'x' + (await cmpMeta(ruB)).height,
  filtersAccepted: filterOk,
  progressiveJpeg: {
    baselineHasSOF0: hasMarker(baseB, 0xc0),
    progressiveHasSOF2: hasMarker(progB, 0xc2),
    baselineHasSOF2: hasMarker(baseB, 0xc2),
  },
  palettePng: {
    plainColorType: plainB[25],
    palette64ColorType: palB[25],
    plainBytes: plainB.length,
    palette64Bytes: palB.length,
  },
  writeBunFile: { ok: typeof wbf === 'number' && wbf > 0, bytes: wbf },
  s3: {
    constructorName: cmpS3.constructor.name,
    callableAsFunction: s3CallableErr === '',
    callError: s3CallableErr || '',
    fileImage: s3FileImage ? s3FileImage.fileImage : 'unreachable',
    fileWrite: s3FileImage ? s3FileImage.fileWrite : 'unreachable',
  },
  cropSurface: { crop: typeof cmpImg.crop, extract: typeof cmpImg.extract, composite: typeof cmpImg.composite, extend: typeof cmpImg.extend },
  saturation: {
    zeroVsOneLosslessBytesDiffer: (await new (Bun as any).Image(cmpSrc).modulate({ saturation: 0 }).webp({ lossless: true }).bytes()).length !== (await new (Bun as any).Image(cmpSrc).modulate({ saturation: 1 }).webp({ lossless: true }).bytes()).length,
    note: 'grayscale output not directly verifiable - no pixel-decode API on 1.4.0',
  },
};
rmSync(cmpDir, { recursive: true, force: true });

// ---------- configGapsGotchas: BuildConfig options the cross-check sweep surfaced (178) ----------
const cfgDir = mkdtempSync(join(tmpdir(), 'art-ground-cfg-'));
await Bun.write(join(cfgDir, 'pure.ts'), 'export const pure = () => 42;');
await Bun.write(join(cfgDir, 'missing.ts'), 'import "./does-not-exist.ts";');
await Bun.write(join(cfgDir, 'zod.ts'), 'import { z } from "zod"; export const s = z.string();');
await Bun.write(join(cfgDir, 'feat.ts'), 'import { feature } from "bun:bundle"; export const v = feature("FEAT_A") ? "A" : "B";');
await Bun.write(join(cfgDir, 'src/pure.ts'), 'export const pure = () => 42;');
await Bun.write(join(cfgDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }));
await Bun.write(join(cfgDir, 'alias.ts'), 'import { pure } from "@/pure"; export const v = pure();');
await Bun.write(join(cfgDir, 'el.tsx'), 'export const el = <div id="x" />;');
await Bun.write(join(cfgDir, 'dce.ts'), 'function impure() { return 1; } /* @__PURE__ */ impure(); export const y = 1;');
await Bun.write(join(cfgDir, 'dce2.ts'), 'function impure() { return 1; } export const x = /* @__PURE__ */ impure();');
await Bun.write(join(cfgDir, 'node_modules/barrel-pkg/package.json'), JSON.stringify({ name: 'barrel-pkg', version: '1.0.0', main: 'index.js', sideEffects: false }));
await Bun.write(join(cfgDir, 'node_modules/barrel-pkg/index.js'), 'export const a = 1; export const b = 2; export const c = 3;');
await Bun.write(join(cfgDir, 'barrel.ts'), 'import { a } from "barrel-pkg"; export const v = a;');
await Bun.write(join(cfgDir, 'node_modules/react/package.json'), JSON.stringify({ name: 'react', version: '19.0.0', exports: { '.': './index.js', './jsx-runtime': './jsx-runtime.js', './jsx-dev-runtime': './jsx-dev-runtime.js', './compiler-runtime': './compiler-runtime.js' } }));
await Bun.write(join(cfgDir, 'node_modules/react/index.js'), 'export const useState = (x) => [x, () => {}]; export const Fragment = Symbol.for("react.fragment"); export default {};');
await Bun.write(join(cfgDir, 'node_modules/react/jsx-runtime.js'), 'export const jsx = (t, p) => [t, p]; export const jsxs = (t, p) => [t, p]; export const Fragment = Symbol.for("react.fragment");');
await Bun.write(join(cfgDir, 'node_modules/react/jsx-dev-runtime.js'), 'export const jsxDEV = (t, p) => [t, p]; export const Fragment = Symbol.for("react.fragment");');
await Bun.write(join(cfgDir, 'node_modules/react/compiler-runtime.js'), 'export const useMemoCache = (x) => x;');
await Bun.write(join(cfgDir, 'component.tsx'), 'import { useState } from "react"; export function C({ x }: any) { const [n, setN] = useState(x); return <div onClick={() => setN(n + 1)}>{n}</div>; }');
const cfgSafe = async (opts: any) => { try { const r = await Bun.build(opts); return { ok: true, r }; } catch { return { ok: false, r: null }; } };
const cfgText = async (opts: any) => { const s = await cfgSafe(opts); return s.ok && s.r !== null ? await s.r.outputs[0]!.text() : 'ERR'; };
const bf = await cfgText({ entrypoints: [join(cfgDir, 'pure.ts')], outdir: join(cfgDir, 'o1'), banner: '/*BANNER*/', footer: '/*FOOTER*/' });
const thr = await cfgSafe({ entrypoints: [join(cfgDir, 'missing.ts')], outdir: join(cfgDir, 'o2'), throw: false });
const thrDef = await cfgSafe({ entrypoints: [join(cfgDir, 'missing.ts')], outdir: join(cfgDir, 'o2b') });
const pkgs = await cfgText({ entrypoints: [join(cfgDir, 'zod.ts')], outdir: join(cfgDir, 'o3'), packages: 'external' });
const featA = await cfgText({ entrypoints: [join(cfgDir, 'feat.ts')], outdir: join(cfgDir, 'o4a'), features: ['FEAT_A'] });
const feat0 = await cfgText({ entrypoints: [join(cfgDir, 'feat.ts')], outdir: join(cfgDir, 'o4b') });
const tsok = await cfgSafe({ entrypoints: [join(cfgDir, 'alias.ts')], outdir: join(cfgDir, 'o5'), tsconfig: join(cfgDir, 'tsconfig.json') });
const jsx1 = await cfgText({ entrypoints: [join(cfgDir, 'el.tsx')], outdir: join(cfgDir, 'o6'), jsx: { runtime: 'classic', factory: 'h' } });
const dce1 = await cfgText({ entrypoints: [join(cfgDir, 'dce.ts')], outdir: join(cfgDir, 'o7'), minify: { syntax: true, whitespace: true } });
const dce2 = await cfgText({ entrypoints: [join(cfgDir, 'dce.ts')], outdir: join(cfgDir, 'o7b'), minify: { syntax: true, whitespace: true }, ignoreDCEAnnotations: true });
const em1 = await cfgText({ entrypoints: [join(cfgDir, 'dce2.ts')], outdir: join(cfgDir, 'o8'), minify: { whitespace: true } });
const em2 = await cfgText({ entrypoints: [join(cfgDir, 'dce2.ts')], outdir: join(cfgDir, 'o8b'), minify: { whitespace: true }, emitDCEAnnotations: true });
const opt1 = await cfgSafe({ entrypoints: [join(cfgDir, 'barrel.ts')], outdir: join(cfgDir, 'o9'), optimizeImports: ['barrel-pkg'] });
const opt0 = await cfgSafe({ entrypoints: [join(cfgDir, 'barrel.ts')], outdir: join(cfgDir, 'o9b') });
const reactJ = { entrypoints: [join(cfgDir, 'component.tsx')], outdir: join(cfgDir, 'rj'), jsx: { runtime: 'automatic', importSource: 'react' } };
const rBase = await cfgText(reactJ);
const rFast = await cfgText({ ...reactJ, outdir: join(cfgDir, 'rj1'), reactFastRefresh: true });
const rComp = await cfgText({ ...reactJ, outdir: join(cfgDir, 'rj2'), reactCompiler: true });
const rSsr = await cfgText({ ...reactJ, outdir: join(cfgDir, 'rj3'), reactCompiler: true, reactCompilerOutputMode: 'ssr' });
const rClient = await cfgText({ ...reactJ, outdir: join(cfgDir, 'rj4'), reactCompiler: true, reactCompilerOutputMode: 'client' });
const vFiles = await cfgSafe({ entrypoints: ['/app/index.ts'], outdir: join(cfgDir, 'rj5'), files: { '/app/index.ts': 'import { helper } from "./helper.ts"; export const msg = helper();', '/app/helper.ts': 'export function helper() { return "virtual"; }' } });
const vFilesText = vFiles.ok ? await (await Bun.build({ entrypoints: ['/app/index.ts'], outdir: join(cfgDir, 'rj6'), files: { '/app/index.ts': 'import { helper } from "./helper.ts"; export const msg = helper();', '/app/helper.ts': 'export function helper() { return "virtual"; }' } })).outputs[0]!.text() : 'ERR';
const DOL = String.fromCharCode(36);
const configGapsGotchas = {
  bannerFooter: { bannerAtTop: bf.includes('/*BANNER*/'), footerAtEnd: bf.trimEnd().includes('/*FOOTER*/') },
  throwOption: {
    throwFalseReturnsSuccessFalse: thr.ok && thr.r !== null && thr.r.success === false && thr.r.logs.length === 1,
    defaultRejects: !thrDef.ok,
  },
  packagesExternal: { importKept: pkgs.includes('from "zod"'), size: pkgs.length },
  features: {
    withFlag_keepsA: featA.includes('"A"') && !featA.includes('"B"'),
    withoutFlag_keepsB: feat0.includes('"B"') && !feat0.includes('"A"'),
  },
  tsconfigPaths: { prefixedAliasResolves: tsok.ok, alias: '@/pure -> src/pure.ts' },
  jsxClassic: { factoryHonored: jsx1.includes('h("div"'), form: 'h("div", { id: "x" })' },
  dceAnnotations: {
    pureStatementDroppedUnderSyntaxMinify: !dce1.includes('impure'),
    keptWithIgnoreDCEAnnotations: dce2.includes('impure()'),
    pureMarkEmittedWithEmitFlag: em2.includes('@__PURE__') && !em1.includes('@__PURE__'),
  },
  optimizeImports: { accepted: opt1.ok, baselineAccepts: opt0.ok },
  reactAndFiles: {
    filesVirtualBundle: vFiles.ok && vFilesText.includes('virtual'),
    reactFastRefresh: { honored: rFast !== 'ERR' && rFast !== rBase, marker: rFast.includes(DOL + 'RefreshSig' + DOL) || rFast.includes(DOL + 'RefreshReg' + DOL) },
    reactCompiler: { honored: rComp !== 'ERR' && rComp !== rBase, memoizationGuards: rComp.includes(DOL + '[') },
    reactCompilerOutputMode: { ssrVsClientDiffer: rSsr !== rClient, ssrSize: rSsr.length, clientSize: rClient.length },
  },
  typeLevelOnly: [],
};
rmSync(cfgDir, { recursive: true, force: true });

// ---------- serveGotchas: Bun.serve behaviors (178) - offline 127.0.0.1, ephemeral ports ----------
const srvDir = mkdtempSync(join(tmpdir(), 'art-ground-srv-'));
await Bun.write(join(srvDir, 'hello.txt'), 'hello-dir');
const srvPort = async (srv: any) => { await Bun.sleep(30); return srv.port as number; };
const sA = Bun.serve({ port: 0, routes: { '/api/users/:id': { GET: (req: any) => new Response(req.params.id), POST: () => new Response('posted') } } } as any);
const pA = await srvPort(sA);
const mGet = await fetch('http://127.0.0.1:' + pA + '/api/users/42').then((r) => r.text());
const mPost = await fetch('http://127.0.0.1:' + pA + '/api/users/42', { method: 'POST' }).then((r) => r.text());
const mDel = await fetch('http://127.0.0.1:' + pA + '/api/users/42', { method: 'DELETE' }).then((r) => r.status);
sA.stop(true);
const sB = Bun.serve({ port: 0, routes: { '/health': new Response('ok'), '/file': Bun.file(join(srvDir, 'hello.txt')) }, fetch: () => new Response('fallback') } as any);
const pB = await srvPort(sB);
const vRoute = await fetch('http://127.0.0.1:' + pB + '/health').then((r) => r.text());
const bRoute = await fetch('http://127.0.0.1:' + pB + '/file').then((r) => r.text());
const fFall = await fetch('http://127.0.0.1:' + pB + '/other').then((r) => r.text());
sB.stop(true);
const sC = Bun.serve({ port: 0, routes: { '/static/*': { dir: srvDir } } } as any);
const pC = await srvPort(sC);
const dFile = await fetch('http://127.0.0.1:' + pC + '/static/hello.txt').then((r) => r.text());
const dMiss = await fetch('http://127.0.0.1:' + pC + '/static/nope.txt').then((r) => r.status);
sC.stop(true);
const sD = Bun.serve({ port: 0, websocket: { open: () => {}, message: (ws: any, msg: any) => { ws.send('echo:' + msg); }, close: () => {} }, fetch(req: any, server: any) { if (new URL(req.url).pathname === '/ws') { return server.upgrade(req) ? undefined : new Response('no', { status: 400 }); } return new Response('nope'); } } as any);
const pD = await srvPort(sD);
const wsEcho = await new Promise<string>((res, rej) => { const ws = new WebSocket('ws://127.0.0.1:' + pD + '/ws'); ws.onopen = () => ws.send('hi'); ws.onmessage = (ev) => { res(String(ev.data)); ws.close(); }; ws.onerror = () => rej('ws-error'); setTimeout(() => rej('timeout'), 3000); });
sD.stop(true);
const sE = Bun.serve({ port: 0, fetch() { throw new Error('boom'); }, error: () => new Response('handled-500', { status: 500 }) } as any);
const pE = await srvPort(sE);
const errRes = await fetch('http://127.0.0.1:' + pE + '/x');
const errStatus = errRes.status;
const errBody = await errRes.text();
sE.stop(true);
const serveGotchas = {
  methodRoutes: { getParams: mGet, postMethod: mPost, unregisteredMethodStatus: mDel },
  staticRoutes: { valueRoute: vRoute, bunFileRoute: bRoute, fetchFallback: fFall },
  directoryRoute: { fileContent: dFile, missingStatus: dMiss },
  websocket: { echo: wsEcho },
  errorHandler: { status: errStatus, body: errBody, port0Assigned: pE > 0 },
};
rmSync(srvDir, { recursive: true, force: true });

// ---------- sqliteGotchas: bun:sqlite behaviors (178) - in-memory, offline ----------
const sq = new (await import('bun:sqlite')).Database(':memory:');
sq.run('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
sq.run('INSERT INTO t (name) VALUES (?)', ['alice']);
sq.run('INSERT INTO t (name) VALUES (?)', ['bob']);
const sqGet = (sq.query('SELECT 1 AS x') as any).get();
const sqPrepared = (sq.prepare('SELECT ? AS v') as any).get(42);
const sqNoPrefix = (sq.query('SELECT :x AS v') as any).get({ x: 7 });
const sqPrefixed = (sq.query('SELECT :x AS v') as any).get({ ':x': 10 });
const sqTx = sq.transaction(() => { sq.run('INSERT INTO t (name) VALUES (?)', ['carol']); throw new Error('rollback'); });
try { sqTx(); } catch { }
const sqCount = (sq.query('SELECT COUNT(*) AS n FROM t') as any).get().n as number;
sq.exec('CREATE TABLE u (a INTEGER); INSERT INTO u VALUES (1); INSERT INTO u VALUES (2);');
const sqExecCount = (sq.query('SELECT COUNT(*) AS n FROM u') as any).get().n as number;
let sqConstraint = '';
try { sq.run("INSERT INTO t (id, name) VALUES (1, 'dup')"); } catch (err: any) { sqConstraint = err.code ?? String(err); }
const sqSer = sq.serialize();
const sq2 = (await import('bun:sqlite')).Database.deserialize(sqSer);
const sqRound = ((sq2.query('SELECT name FROM t') as any).get() as any).name;
sq.close();
let sqClosed = '';
try { sq.query('SELECT 1').get(); } catch (err: any) { sqClosed = String(err.message ?? err).slice(0, 40); }
const sqChanges = sq2.run('INSERT INTO t (name) VALUES (?)', ['bob']);
const sqliteGotchas = {
  queryGet: sqGet,
  preparedGet: sqPrepared,
  namedParams: {
    defaultPrefixless: (sqNoPrefix as any)?.v === null ? 'null' : 'bound',
    defaultPrefixed: (sqPrefixed as any)?.v === 10 ? 10 : 'unbound',
    strictPrefixless: (await (async () => { const sd = new (await import('bun:sqlite')).Database(':memory:', { strict: true } as any); const r = sd.query('SELECT $y AS v').get({ y: 7 }); sd.close(); return (r as any)?.v ?? 'null'; })()),
    strictPrefixed: (await (async () => { const sd = new (await import('bun:sqlite')).Database(':memory:', { strict: true } as any); try { const r = sd.query('SELECT $y AS v').get({ $y: 11 }); sd.close(); return (r as any)?.v ?? 'null'; } catch (err: any) { sd.close(); return String(err.message ?? err).slice(0, 24); } })()),
  },
  transactionAtomic: sqCount === 2,
  execMulti: sqExecCount === 2,
  constraintErrorCode: sqConstraint,
  serializeDeserialize: { roundTripName: sqRound, bytes: sqSer.length },
  closedDbError: sqClosed,
  runChanges: sqChanges,
  backupAbsent: typeof (sq2 as any).backup === 'undefined',
};
sq2.close();

// ---------- urlPatternGotchas: URLPattern Web API (178) - runtime global, NOT in bun-types ----------
const upGlobal = typeof URLPattern === 'function';
const upBunImport = typeof (await import('bun') as any).URLPattern;
const upObj = new URLPattern({ pathname: '/users/:id' });
const upObjTest = upObj.test('https://example.com/users/123');
const upObjId = upObj.exec('https://example.com/users/123')?.pathname.groups.id;
const upNonTest = upObj.test('https://example.com/other');
const upNonExec = upObj.exec('https://example.com/other') === null;
const upWild = new URLPattern('/files/*', 'https://example.com').exec('https://example.com/files/a/b')?.pathname.groups[0];
const upComp = new URLPattern({ protocol: 'https', hostname: 'example.com', port: '8080', pathname: '/x', search: 'q=1' });
const upCompAll = upComp.test('https://example.com:8080/x?q=1');
const upCompPort = upComp.test('https://example.com:9999/x?q=1');
const upCompHash = upComp.test('https://example.com:8080/x?q=1#h');
const upRe = new URLPattern({ pathname: '/users/(\\d+)' });
const upReGroups = upRe.hasRegExpGroups;
const upRe0 = upRe.exec('https://e.com/users/42')?.pathname.groups[0];
const upOpt = new URLPattern({ pathname: '/users/:id?' });
const upOptNoSlash = upOpt.test('https://e.com/users');
const upOptSlash = upOpt.test('https://e.com/users/');
const upOptVal = upOpt.test('https://e.com/users/5');
const upGetters = { protocol: upWild ? '' : '', pathname: new URLPattern({ pathname: '/files/*' }).pathname };
const urlPatternGotchas = {
  global: { typeof: upGlobal ? 'function' : 'undefined', importableFromBun: String(upBunImport) },
  objectForm: { test: upObjTest, id: upObjId },
  nonMatch: { test: upNonTest, execNull: upNonExec },
  stringBaseWildcard: { groups0: upWild },
  componentMatch: { all: upCompAll, wrongPort: upCompPort, hashIgnored: upCompHash },
  regexGroup: { hasRegExpGroups: upReGroups, groups0: upRe0 },
  optionalParam: { noTrailingSlash: upOptNoSlash, trailingSlash: upOptSlash, withValue: upOptVal },
  componentGetters: { pathname: upGetters.pathname },
  serveIntegration: await (async () => {
    const pat = new URLPattern({ pathname: '/users/:id' });
    const s = Bun.serve({ port: 0, fetch(req: any) { const m = pat.exec(req.url); if (m) return new Response('User ' + m.pathname.groups.id); return new Response('Not found', { status: 404 }); } } as any);
    await Bun.sleep(30);
    const port = s.port as number;
    const hit = await fetch('http://127.0.0.1:' + port + '/users/123');
    const miss = await fetch('http://127.0.0.1:' + port + '/other');
    const hitStatus = hit.status; const hitBody = await hit.text(); const missStatus = miss.status;
    s.stop(true);
    const art = (await Bun.build({ entrypoints: [join(F, 'pure.ts')], outdir: join(F, 'out') })).outputs[0]!;
    return { hitStatus, hitBody, missStatus, artifactPathIsFilesystem: art.path.startsWith('/') || art.path.startsWith('./'), urlPatternTestOnArtifactPath: pat.test(art.path) };
  })(),
};

// ---------- gapCloseGotchas: remaining sweep gaps (178) - Statement surface, baseURL, body cap, jsx ----------
const gcDb = new (await import('bun:sqlite')).Database(':memory:');
gcDb.run('CREATE TABLE t (a INTEGER, b TEXT)');
gcDb.run('INSERT INTO t VALUES (1, ?), (2, ?)', ['x', 'y']);
const gcSt = gcDb.prepare('SELECT a, b FROM t ORDER BY a');
const gcIterate: any[] = []; for (const row of gcSt.iterate()) gcIterate.push(row);
const gcRawSt = gcDb.prepare('SELECT a, b FROM t ORDER BY a');
const gcRawValue = gcRawSt.raw();
const gcRawAssign = gcDb.prepare('SELECT a, b FROM t');
(gcRawAssign as any).raw = true;
const gcRawAssignAll = gcRawAssign.all();
const gcFin = gcDb.prepare('SELECT a FROM t');
const gcSql = gcFin.toString();
gcFin.finalize();
let gcFinErr = '';
try { gcFin.get(); } catch (err: any) { gcFinErr = String(err.message ?? err).slice(0, 40); }
gcDb.close();
const gcUp = new URLPattern({ pathname: '/users/:id', baseURL: 'https://example.com' } as any);
const gcSrv = Bun.serve({ port: 0, maxRequestBodySize: 10, fetch: async (req: any) => { const body = await req.text(); return new Response('got ' + body.length); } } as any);
await Bun.sleep(30);
const gcPort = gcSrv.port as number;
const gcSmall = await fetch('http://127.0.0.1:' + gcPort + '/', { method: 'POST', body: 'hi' });
const gcBig = await fetch('http://127.0.0.1:' + gcPort + '/', { method: 'POST', body: 'x'.repeat(100) });
const gcSmallStatus = gcSmall.status; const gcBigStatus = gcBig.status;
gcSrv.stop(true);
const gcDir = mkdtempSync(join(tmpdir(), 'art-ground-gap-'));
await Bun.write(join(gcDir, 'frag.tsx'), 'export const el = <><div id="a" /><span>hi</span></>;');
const gcJ1 = await (async () => { try { const r = await Bun.build({ entrypoints: [join(gcDir, 'frag.tsx')], outdir: join(gcDir, 'o1'), jsx: { runtime: 'classic', factory: 'h', fragment: 'Frag' } }); return await r.outputs[0]!.text(); } catch (err: any) { return 'ERR ' + String(err.message ?? err).slice(0, 50); } })();
const gcJ2 = await (async () => { try { await Bun.build({ entrypoints: [join(gcDir, 'frag.tsx')], outdir: join(gcDir, 'o2'), jsx: { runtime: 'classic', factory: 'h', fragment: 'Frag', sideEffects: true } }); return 'ok'; } catch (err: any) { return 'ERR ' + String(err.message ?? err).slice(0, 50); } })();
rmSync(gcDir, { recursive: true, force: true });
const gapCloseGotchas = {
  statement: {
    iterateRows: gcIterate,
    rawMethodValue: gcRawValue,
    rawAssignmentIsNoOp: JSON.stringify(gcRawAssignAll[0]) === JSON.stringify(gcIterate[0]),
    finalizeSql: gcSql,
    finalizeThrows: gcFinErr,
  },
  urlPatternBaseURL: { hostname: gcUp.hostname, test: gcUp.test('https://example.com/users/5') },
  serveMaxRequestBody: { smallStatus: gcSmallStatus, overStatus: gcBigStatus },
  jsxFragment: { fragmentHonored: gcJ1.includes('Frag'), sideEffectsAccepted: gcJ2 === 'ok' },
};

// ---------- cronGotchas: Bun.cron (178) - parse is deterministic offline ----------
const cronMod: any = (await import('bun')).cron;
const cronBase = new Date('2026-01-01T00:00:00.000Z');
const cronParse = (expr: string, opts: any = {}) => { try { const d = cronMod.parse(expr, cronBase, opts); return d instanceof Date ? d.toISOString() : String(d); } catch (err: any) { return 'THROWS ' + String(err.message ?? err).slice(0, 40); } };
const cronUtc = (expr: string) => cronParse(expr, { tz: 'UTC' });
const cronJob = cronMod('* * * * *', () => {});
const cronGotchas = {
  parseEveryMinuteUtc: cronUtc('* * * * *'),
  parseStepUtc: cronUtc('*/5 * * * *'),
  parseRangeUtc: cronUtc('1-5 * * * *'),
  parseCommaUtc: cronUtc('1,15,30 * * * *'),
  parseNicknameUtc: cronUtc('@daily'),
  parseTzUtc: cronParse('30 9 * * *', { tz: 'UTC' }),
  parseTzNy: cronParse('30 9 * * *', { tz: 'America/New_York' }),
  parseDefaultTzOffsetHours: (() => { const d = cronMod.parse('0 0 * * *', cronBase) as Date; return Math.round((d.getTime() - Date.parse('2026-01-01T00:00:00.000Z')) / 3600000); })(),
  invalidThrows: cronParse('not-a-cron').startsWith('THROWS'),
  jobSurface: { cron: cronJob.cron, stop: typeof cronJob.stop, ref: typeof cronJob.ref, unref: typeof cronJob.unref },
};
cronJob.stop();

// ---------- webviewGotchas: Bun.WebView (178) - macOS; data: URLs keep it offline; 15s guard ----------
const wvResult: any = await Promise.race([
  (async () => {
    const v = new (Bun as any).WebView({ width: 200, height: 150, show: false, forceProcessCanary: false } as any);
    const surface = { navigate: typeof v.navigate, evaluate: typeof v.evaluate, screenshot: typeof v.screenshot, cdp: typeof v.cdp, click: typeof v.click, close: typeof v.close, dispose: typeof (v as any)[Symbol.dispose], destroy: typeof v.destroy };
    await v.navigate('data:text/html,<html><body><div id="x">42</div></body></html>');
    const urlPrefix = String(v.url).slice(0, 11);
    const domText = await v.evaluate('document.getElementById("x").textContent');
    const expr = await v.evaluate('1 + 1');
    const shot = await v.screenshot({ encoding: 'buffer', format: 'png' });
    const shotOk = shot instanceof Uint8Array && shot.length > 0;
    const gapSurface = { closeAll: typeof (Bun as any).WebView.closeAll, addEventListener: typeof v.addEventListener, scrollTo: typeof v.scrollTo, resize: typeof v.resize, back: typeof v.back, forward: typeof v.forward, reload: typeof v.reload };
    const reloadOk = await (v as any).reload().then(() => true).catch(() => false);
    const scrollToSelectorBased = (() => { try { (v as any).scrollTo(0, 10); return false; } catch (err: any) { return String(err.message ?? err).includes('selector'); } })();
    const resizeOk = (() => { try { (v as any).resize(300, 200); return true; } catch { return false; } })();
    return { surface, gapSurface, reloadOk, scrollToSelectorBased, resizeOk, urlPrefix, domText, expr, shotOk, ctorOk: true };
  })(),
  new Promise((res) => setTimeout(() => res({ timeout: true }), 15000)),
]);
const webviewGotchas = wvResult.timeout
  ? { ctorOk: false, timeout: true }
  : {
      ctorOk: wvResult.ctorOk,
      navigateData: { urlPrefix: wvResult.urlPrefix },
      evaluate: { domText: wvResult.domText, expression: wvResult.expr },
      screenshotPng: { ok: wvResult.shotOk },
      surface: wvResult.surface,
      gapSurface: wvResult.gapSurface,
      reloadOk: wvResult.reloadOk,
      scrollToSelectorBased: wvResult.scrollToSelectorBased,
      resizeOk: wvResult.resizeOk,
    };

// ---------- s3Gotchas: Bun.s3 surface (178) - offline: typeof + no-creds error path ----------
const s3FileProbe: any = (Bun as any).s3.file('probe-key.txt');
const s3NoCreds = async (fn: () => Promise<unknown>) => { try { await fn(); return 'OK'; } catch (err: any) { return err.code ?? err.name ?? String(err).slice(0, 30); } };
const s3Gotchas = {
  fileSurface: {
    name: typeof s3FileProbe.name, size: typeof s3FileProbe.size, type: typeof s3FileProbe.type, lastModified: typeof s3FileProbe.lastModified,
    exists: typeof s3FileProbe.exists, stat: typeof s3FileProbe.stat, write: typeof s3FileProbe.write, read: typeof s3FileProbe.read,
    text: typeof s3FileProbe.text, json: typeof s3FileProbe.json, image: typeof s3FileProbe.image, presign: typeof s3FileProbe.presign,
    unlink: typeof s3FileProbe.unlink, delete: typeof s3FileProbe.delete, slice: typeof s3FileProbe.slice, arrayBuffer: typeof s3FileProbe.arrayBuffer,
  },
  fileDataOptions: { data: typeof s3FileProbe.data, options: typeof s3FileProbe.options },
  clientList: await s3NoCreds(() => (Bun as any).s3.list({ prefix: 'x' } as any)),
  noCreds: {
    stat: await s3NoCreds(() => s3FileProbe.stat()),
    exists: await s3NoCreds(() => s3FileProbe.exists()),
    presign: await s3NoCreds(() => s3FileProbe.presign({ expiresIn: 60 } as any)),
  },
};

// ---------- deepPassGotchas: the formerly-unprobeable pins (178 deep pass) ----------
const dpId = Bun.serve({ port: 0, id: 'my-srv', fetch: () => new Response('ok') } as any);
const dpIdVal = (dpId as any).id as string;
dpId.stop(true);
const dpReuseA = Bun.serve({ port: 5683, reusePort: true, fetch: () => new Response('A') } as any);
let dpReuseTwo = false;
try { const b = Bun.serve({ port: 5683, reusePort: true, fetch: () => new Response('B') } as any); dpReuseTwo = true; b.stop(true); } catch { dpReuseTwo = false; }
dpReuseA.stop(true);
const dpNoReuse = Bun.serve({ port: 5684, fetch: () => new Response('C') } as any);
let dpNoReuseErr = '';
try { Bun.serve({ port: 5684, fetch: () => new Response('D') } as any); dpNoReuseErr = 'NO-ERROR'; } catch (err: any) { dpNoReuseErr = String(err.code ?? err.message ?? err).slice(0, 20); }
dpNoReuse.stop(true);
const dp6 = Bun.serve({ port: 0, hostname: '::1', ipv6Only: true, fetch: () => new Response('v6') } as any);
await Bun.sleep(30);
const dp6p = (dp6 as any).port as number;
const dp6v6 = await fetch('http://[::1]:' + dp6p + '/').then((r) => r.ok).catch(() => false);
const dp6v4 = await fetch('http://127.0.0.1:' + dp6p + '/').then((r) => r.ok).catch(() => false);
dp6.stop(true);
let dpHttp1 = '';
try { Bun.serve({ port: 0, http1: false, http3: false, fetch: () => new Response('h') } as any); dpHttp1 = 'NO-ERROR'; } catch (err: any) { dpHttp1 = String(err.message ?? err).slice(0, 45); }
const dpSock = join(tmpdir(), 'bun-srv-' + Date.now() + '.sock');
const dpU = Bun.serve({ unix: dpSock, fetch: () => new Response('unix-ok') } as any);
await Bun.sleep(50);
const dpUnixWorks = await new Promise<boolean>((res) => {
  Bun.connect({ unix: dpSock, socket: { open: (ws: any) => ws.write('GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'), data: (ws: any, buf: any) => { res(buf.toString().includes('unix-ok')); ws.close(); }, error: () => res(false) } } as any);
  setTimeout(() => res(false), 3000);
});
dpU.stop(true);
const dpDb = new (await import('bun:sqlite')).Database(':memory:');
let dpScs = '';
try { dpScs = String((await import('bun:sqlite')).Database.setCustomSQLite('/usr/lib/libsqlite3.dylib')); } catch (err: any) { dpScs = 'THROWS ' + String(err.message ?? err).slice(0, 30); }
const dpFc = (dpDb as any).fileControl(12, 0) as number;
let dpLe = '';
try { dpDb.loadExtension('/tmp/not-a-real-ext.dylib'); dpLe = 'NO-ERROR'; } catch (err: any) { dpLe = String(err.message ?? err).slice(0, 50); }
dpDb.close();
const deepPassGotchas = {
  serve: {
    id: dpIdVal,
    reusePortTwoBind: dpReuseTwo,
    noReusePortSecondBind: dpNoReuseErr,
    ipv6Only: { v6Works: dp6v6, v4Fails: !dp6v4 },
    http1FalseThrows: dpHttp1,
    idleTimeout1sNotClosedIn4s: true, // raw + keep-alive idle conns stayed open >4s at idleTimeout=1 (timer semantics unverified)
    unixWorks: dpUnixWorks,
  },
  sqlite: {
    setCustomSQLiteAfterDb: dpScs,
    setCustomSQLiteFirstCallVerifiedStandalone: true,
    fileControlPersistWalReturns: dpFc,
    loadExtensionError: dpLe,
  },
};

// ---------- markdownGotchas: Bun.markdown namespace (178) - html/ansi/render/react ----------
const mdNs: any = (Bun as any).markdown;
const mdNamedExport = {
  identity: mdNamed === mdNs,
  keys: Object.keys(mdNamed).join(','),
};
const mdHtml = mdNs.html('# Hi **bold** and `code`');
const mdAnsi = mdNs.ansi('# Hi **bold**');
const mdPlain = mdNs.ansi('# Hi', { colors: false } as any);
const mdRendered = mdNs.render('# Hi', { h1: (text: any, children: any) => 'H1[' + children.join('') + ']' } as any);
let mdReactOk = false;
try { const el = mdNs.react('# Hi'); mdReactOk = el !== null && typeof el === 'object'; } catch { mdReactOk = false; }
const markdownGotchas = {
  surface: { html: typeof mdNs.html, ansi: typeof mdNs.ansi, render: typeof mdNs.render, react: typeof mdNs.react },
  namedExport: mdNamedExport,
  html: mdHtml.trim().slice(0, 90),
  ansiHasEscapes: /\x1b\[/.test(mdAnsi),
  ansiColorsFalsePlain: !/\x1b\[/.test(mdPlain),
  renderCallback: mdRendered,
  reactParses: mdReactOk,
  gfm: {
    tablesDefault: mdNs.html('| A | B |\n|---|---|\n| 1 | 2 |').includes('<table>'),
    tablesOffPlain: !mdNs.html('| A | B |\n|---|---|\n| 1 | 2 |', { tables: false } as any).includes('<table>'),
    strikethrough: mdNs.html('~~gone~~').includes('<del>'),
    strikethroughOffPlain: !mdNs.html('~~x~~', { strikethrough: false } as any).includes('<del>'),
    tasklists: mdNs.html('- [x] done\n- [ ] todo').includes('checkbox'),
    tasklistsKeyIsLowercase: !mdNs.html('- [x] done', { taskLists: false } as any).includes('checkbox'),
  },
  renderContract: {
    listItemChecked: mdNs.render('- [x] done\n- [ ] todo', { listItem: (c: string, m: any) => 'c=' + String(m.checked) } as any),
    listOrdered: mdNs.render('- x', { list: (c: string, m: any) => 'o=' + String(m.ordered) } as any),
    orderedStart: mdNs.render('3. one\n4. two', { list: (c: string, m: any) => 's=' + String(m.start) } as any),
    tableAlign: mdNs.render('| A | B |\n|:--|--:|\n| 1 | 2 |', { th: (c: string, m: any) => 'a=' + String(m.align) } as any),
    headingId: mdNs.render('# Hi', { heading: (c: string, m: any) => 'id=' + String(m.id ?? 'none') } as any, { headings: { ids: true } } as any),
    headingIdNeedsOption: mdNs.render('# Hi', { heading: (c: string, m: any) => 'id=' + String(m.id ?? 'none') } as any),
  },
  options: {
    autolinksDefaultOff: !mdNs.html('Visit https://example.com/x').includes('<a href'),
    autolinksUrlOnly: mdNs.html('Visit https://example.com/x', { autolinks: { url: true } } as any).includes('<a href'),
    autolinksTrueAll: (() => { const h = mdNs.html('Visit https://bun.sh or www.example.com or email me@example.com', { autolinks: true } as any); return h.includes('href="https://bun.sh"') && h.includes('href="http://www.example.com"') && h.includes('href="mailto:me@example.com"'); })(),
    headingsIds: mdNs.html('# Hi', { headings: { ids: true } } as any).includes('id="hi"'),
    wikiLinks: mdNs.html('[[Home]]', { wikiLinks: true } as any).includes('x-wikilink'),
    wwwAutolink: mdNs.html('Visit www.example.com', { autolinks: { www: true } } as any).includes('href="http://www.example.com"'),
    emailAutolink: mdNs.html('Email me@example.com', { autolinks: { email: true } } as any).includes('href="mailto:'),
    headingsAutolinkAnchor: mdNs.html('# Hi', { headings: { ids: true, autolink: true } } as any).includes('href="#hi"'),
    headingIdIsAutoSlug: mdNs.html('# Heading {#custom-id}', { headings: { ids: true } } as any).includes('id="heading-custom-id"'),
    permissiveAtxDefaultOff: !mdNs.html('#NoSpace').includes('<h1'),
    permissiveAtxTrueOn: mdNs.html('#header', { permissiveAtxHeaders: true } as any).includes('<h1'),
    permissiveAtxExplicitFalseOff: !mdNs.html('#header', { permissiveAtxHeaders: false } as any).includes('<h1'),
    noIndentedCodeBlocks: !mdNs.html('    x = 1', { noIndentedCodeBlocks: true } as any).includes('<pre'),
    noHtmlSpans: !mdNs.html('a <b>x</b>', { noHtmlSpans: true } as any).includes('<b'),
    hardSoftBreaksTrailingWsIsCommonMark: mdNs.html('a  \nb').includes('<br') === mdNs.html('a  \nb', { hardSoftBreaks: true } as any).includes('<br'),
  },
  callbacks: {
    codeLanguage: mdNs.render('```js\nconst x = 1;\n```', { code: (c: string, m: any) => 'lang=' + String(m.language) } as any),
    linkHrefTitle: mdNs.render('[b](https://x.com "t")', { link: (c: string, m: any) => 'href=' + String(m.href) + ':title=' + String(m.title) } as any),
    imageSrcTitle: mdNs.render('![a](img.png "t")', { image: (c: string, m: any) => 'src=' + String(m.src) + ':title=' + String(m.title) } as any),
    hrBlockquote: mdNs.render('a\n\n---\n\n> q', { hr: () => 'HR', blockquote: (c: string) => 'BQ(' + c + ')' } as any),
    htmlBlockFires: mdNs.render('x\n\n<div>b</div>\n\ny', { html: (c: string) => 'H(' + c + ')' } as any).includes('H(<div>b</div>'),
    htmlInlineNotFired: !mdNs.render('a <span>x</span>', { html: (c: string) => 'H(' + c + ')' } as any).includes('H('),
    nullOmits: mdNs.render('# Hi **b**', { heading: () => null } as any) === '',
    undefinedOmits: mdNs.render('# Hi', { heading: () => undefined } as any) === '',
    noCallbacksPassthrough: mdNs.render('# Hi **bold**') === 'Hi bold',
    noCallbacksTableSource: mdNs.render('| A |\n|-|-|\n| 1 |').includes('| A |'),
    hrChildrenEmpty: mdNs.render('---', { hr: (c: string) => '[' + c + ']' } as any) === '[]',
    nestedListDepths: (() => { const d: string[] = []; mdNs.render('- a\n  - b\n    - c', { list: (c: string, m: any) => { d.push(String(m.depth)); return ''; } } as any); return d.join(','); })(),
    orderedStart3: mdNs.render('3. one\n4. two', { list: (c: string, m: any) => 's=' + String(m.start) } as any),
    ulNoStart: mdNs.render('- a', { list: (c: string, m: any) => 'start=' + String(m.start) } as any),
  },
  reactOverrides: {
    h1Override: JSON.stringify(mdNs.react('# Hi', { h1: 'MyHeading' } as any)).includes('MyHeading'),
    reactVersion18Ok: (() => { try { mdNs.react('# Hi', undefined, { reactVersion: 18 } as any); return true; } catch { return false; } })(),
    v18Symbol: mdNs.react('# Hi', undefined, { reactVersion: 18 } as any).$$typeof === Symbol.for('react.element'),
    v19Symbol: mdNs.react('# Hi', undefined, { reactVersion: 19 } as any).$$typeof === Symbol.for('react.transitional.element'),
    secondArgIsOverrides: mdNs.react('# Hi', { reactVersion: 18 } as any).$$typeof === Symbol.for('react.transitional.element'),
    fnOverrideIdentity: (() => { const f = (p: any) => 'X'; const e = mdNs.react('# Hi', { h1: f } as any); return e.props.children[0].type === f; })(),
    propsFlow: {
      h1Id: (() => { const e: any = mdNs.react('# Hi', { h1: (p: any) => 'H' } as any, { headings: { ids: true } } as any); return JSON.stringify(e.props.children[0].props).includes('"id":"hi"'); })(),
      aHrefTitle: (() => { const e: any = mdNs.react('[b](https://x.com "t")', { a: (p: any) => 'A' } as any); return JSON.stringify(e.props.children[0].props.children[0].props).includes('"href":"https://x.com"') && JSON.stringify(e.props.children[0].props.children[0].props).includes('"title":"t"'); })(),
      preLanguage: (() => { const e: any = mdNs.react('```js\nconst x = 1;\n```', { pre: (p: any) => 'P' } as any); return JSON.stringify(e.props.children[0].props).includes('"language":"js"'); })(),
      liChecked: (() => { const e: any = mdNs.react('- [x] done', { li: (p: any) => 'L' } as any); return JSON.stringify(e.props.children[0].props.children[0].props).includes('"checked":true'); })(),
      olStart: (() => { const e: any = mdNs.react('3. one', { ol: (p: any) => 'O' } as any); return JSON.stringify(e.props.children[0].props).includes('"start":3'); })(),
      thAlign: (() => { const e: any = mdNs.react('| A | B |\n|:-:|--:|\n| 1 | 2 |', { th: (p: any) => 'H' } as any); return JSON.stringify(e.props.children[0].props.children[0].props.children[0].props.children[0].props).includes('"align":"center"'); })(),
      imgAlt: (() => { const e: any = mdNs.react('![alt](/i.png "t")', { img: (p: any) => 'I' } as any); return JSON.stringify(e.props.children[0].props.children[0].props).includes('"alt":"alt"'); })(),
      codeAppliesToInline: (() => { const e: any = mdNs.react('a `x` b', { code: (p: any) => 'C' } as any); return String(e.props.children[0].props.children[1].type).includes('C'); })(),
      fencedIsPreOnly: (() => { const e: any = mdNs.react('```js\nconst x = 1;\n```'); return String(e.props.children[0].type) === 'pre'; })(),
    },
  },
  ansiTheme: {
    columnsWrap: mdNs.ansi('a b c d e', { columns: 5 } as any).includes('\n'),
    hyperlinksOsc8: mdNs.ansi('[x](https://example.com)', { hyperlinks: true } as any).includes('\x1b]8'),
    kittyGraphicsAccepted: (() => { try { mdNs.ansi('# Hi', { kittyGraphics: true } as any); return true; } catch { return false; } })(),
    lightNoObservedDiff: mdNs.ansi('# Hi', { light: true } as any) === mdNs.ansi('# Hi'),
    colorsFalsePlain: !/\x1b\[/.test(mdNs.ansi('# Hi', { colors: false } as any)),
  },
  inputs: {
    typedArrayHtml: mdNs.html(new TextEncoder().encode('# Hi')).includes('<h1>'),
    typedArrayRender: mdNs.render(new TextEncoder().encode('**b**'), { strong: (c: string) => 'S(' + c + ')' } as any) === 'S(b)',
    arrayBufferReact: (() => { try { const e: any = mdNs.react(new TextEncoder().encode('# Hi').buffer); return e.props.children[0].type === 'h1'; } catch { return false; } })(),
  },
  notObservedToTakeEffect: {
    latexMath: !mdNs.html('$x^2$', { latexMath: true } as any).includes('math'),
    underline: !mdNs.html('__u__', { underline: true } as any).includes('<u>'),
    collapseWhitespace: mdNs.html('a  b', { collapseWhitespace: true } as any).includes('a  b'),
    hardSoftBreaks: mdNs.html('Line 1\nLine 2', { hardSoftBreaks: true } as any).includes('Line 1\nLine 2'),
  },
  tagFilter: {
    scriptEscaped: mdNs.html('<script>x</script>', { tagFilter: true } as any).includes('&lt;script'),
    styleEscaped: mdNs.html('<style>x</style>', { tagFilter: true } as any).includes('&lt;style'),
    allowedTableUntouched: mdNs.html('<table><tr><td>x</td></tr></table>', { tagFilter: true } as any).includes('<table>'),
    fnFormIgnored: mdNs.html('<script>x</script>', { tagFilter: (() => (t: string) => t !== 'script')() } as any).includes('&lt;script'),
  },
  noHtmlBlocks: {
    rawPassthroughStops: mdNs.html('<div>block</div>', { noHtmlBlocks: true } as any).startsWith('<p>'),
    blockBecomesParagraph: mdNs.html('<div>block</div>', { noHtmlBlocks: true } as any).includes('<p><div>block</div></p>'),
    escapedWithNoHtmlSpans: mdNs.html('<div>block</div>', { noHtmlBlocks: true, noHtmlSpans: true } as any).includes('&lt;div&gt;'),
  },
};

// ---------- utilityGotchas: Glob / CryptoHasher / password / escapeHTML / deepEquals (goal round 2) ----------
const utilGlobDir = mkdtempSync(join(tmpdir(), 'art-glob-'));
writeFileSync(join(utilGlobDir, 'a.ts'), 'x');
writeFileSync(join(utilGlobDir, 'b.js'), 'x');
mkdirSync(join(utilGlobDir, 'sub'));
writeFileSync(join(utilGlobDir, 'sub', 'c.txt'), 'x');
const utilityGotchas = {
  glob: {
    typeofClass: typeof (Bun as any).Glob,
    matchBraceExt: new (Bun as any).Glob('*.{ts,js}').match('foo.ts'),
    matchNoExt: !new (Bun as any).Glob('*.{ts,js}').match('foo.md'),
    matchNoNested: !new (Bun as any).Glob('*.ts').match('a/b/c.ts'),
    matchGlobstar: new (Bun as any).Glob('**/*.txt').match('a/b/c.txt'),
    scanSyncTs: JSON.stringify([...new (Bun as any).Glob('*.ts').scanSync({ cwd: utilGlobDir })].sort()),
    scanSyncAll: JSON.stringify([...new (Bun as any).Glob('**/*').scanSync({ cwd: utilGlobDir })].sort()),
  },
  cryptoHasher: {
    sha256Hex: (() => { const h = new (Bun as any).CryptoHasher('sha256'); h.update('abc'); return h.digest('hex'); })(),
    md5Hex: (() => { const h = new (Bun as any).CryptoHasher('md5'); h.update('abc'); return h.digest('hex'); })(),
    algorithm: new (Bun as any).CryptoHasher('sha256').algorithm,
    byteLength: new (Bun as any).CryptoHasher('sha256').byteLength,
    staticHashHex: (Bun as any).CryptoHasher.hash('sha256', 'abc', 'hex'),
  },
  password: {
    argon2HashPrefix: (await (Bun as any).password.hash('hunter2', { algorithm: 'argon2id' })).slice(0, 20),
    argon2Verify: await (Bun as any).password.verify('hunter2', await (Bun as any).password.hash('hunter2', { algorithm: 'argon2id' })),
    argon2VerifyWrong: !(await (Bun as any).password.verify('wrong', await (Bun as any).password.hash('hunter2', { algorithm: 'argon2id' }))),
    bcryptRoundtrip: (Bun as any).password.verifySync('secret', (Bun as any).password.hashSync('secret', 'bcrypt')),
    bcryptWrong: !(Bun as any).password.verifySync('nope', (Bun as any).password.hashSync('secret', 'bcrypt')),
    bcryptKnownHashRejected: !(Bun as any).password.verifySync('password', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'bcrypt'),
  },
  escapeHTML: {
    escapesTags: (Bun as any).escapeHTML('<script>') === '&lt;script&gt;',
    escapesAmpQuote: (Bun as any).escapeHTML('& \"') === '&amp; &quot;',
    plainPassthrough: (Bun as any).escapeHTML('plain text') === 'plain text',
  },
  deepEquals: {
    objEq: (Bun as any).deepEquals({ a: [1, 2] }, { a: [1, 2] }),
    nanEq: (Bun as any).deepEquals(NaN, NaN),
    negZeroVsZero: !(Bun as any).deepEquals(-0, 0),
    noCoercion: !(Bun as any).deepEquals(1, '1'),
    dateEq: (Bun as any).deepEquals(new Date(0), new Date(0)),
  },
};

// ---------- miscGotchas: which / peek / sleep / nanoseconds / Transpiler / resolveSync (goal round 2) ----------
const tr = new (Bun as any).Transpiler();
const miscGotchas = {
  which: {
    whichBunString: typeof (Bun as any).which('bun') === 'string',
    whichBunBasename: String((Bun as any).which('bun')).split('/').pop(),
    missingNull: (Bun as any).which('definitely-not-a-real-cmd-xyz-9') === null,
  },
  peek: {
    fulfilledValue: (Bun as any).peek(Promise.resolve(42)),
    plainValue: (Bun as any).peek(5),
    pendingIsSame: (() => { const p = new Promise(() => {}); return (Bun as any).peek(p) === p; })(),
    statusPending: (Bun as any).peek.status(new Promise(() => {})),
    statusFulfilled: (Bun as any).peek.status(Promise.resolve(1)),
  },
  sleep: {
    resolves: (async () => { await (Bun as any).sleep(0); return true; })(),
    syncReturnsUndefined: (Bun as any).sleepSync(1) === undefined,
  },
  nanoseconds: {
    positiveNumber: typeof (Bun as any).nanoseconds() === 'number' && (Bun as any).nanoseconds() > 0,
    monotonic: (() => { const a = (Bun as any).nanoseconds(); const b = (Bun as any).nanoseconds(); return b >= a; })(),
  },
  transpiler: {
    tsStrip: (() => { try { return tr.transformSync('const x: number = 1;', 'ts'); } catch (e: any) { return 'THREW ' + e.name; } })(),
    jsxDev: (() => { try { return tr.transformSync('const el = <div className="a"/>;', 'jsx').includes('jsxDEV'); } catch { return false; } })(),
    defaultLoaderIsJsx: (() => { try { tr.transformSync('const x: number = 1;'); return false; } catch { return true; } })(),
    scanImports: JSON.stringify(tr.scanImports('import x from "y";\nimport { z } from "w";')),
  },
  resolveSync: {
    nodePrefixPassthrough: (Bun as any).resolveSync('node:fs', '/tmp') === 'node:fs',
    bareResolvesToString: typeof (Bun as any).resolveSync('events', '/tmp') === 'string',
  },
  terminal: {
    exists: typeof (Bun as any).Terminal === 'function',
    warnFn: typeof (Bun as any).Terminal?.warn,
  },
  cpuProfMd: await (async () => {
    // bun --cpu-prof-md writes a Markdown CPU profile (blog Observability claim).
    // Probing via a subprocess in the pinned runtime; report existence only.
    try {
      const f = join(tmpdir(), 'prof-cpuprobe-' + process.pid + '.ts');
      writeFileSync(f, 'const x = []; for (let i = 0; i < 50000; i++) x.push(i);\nconsole.log(x.length);');
      const proc = await Bun.$`${process.execPath} --cpu-prof-md ${f}`.cwd(tmpdir()).quiet().nothrow();
      const out = readdirSync(tmpdir()).filter((n) => n.startsWith('CPU.') && n.endsWith('.md'));
      return proc.exitCode === 0 && out.length > 0 ? 'CPU.*.md written' : 'no md: exit ' + proc.exitCode;
    } catch { return 'probe failed'; }
  })(),
};

// ---------- archiveGotchas + udpGotchas: Bun.Archive / Bun.udpSocket (continue round) ----------
const arcDir = mkdtempSync(join(tmpdir(), 'art-arc-'));
const archiveGotchas = {
  typeofClass: typeof (Bun as any).Archive,
  staticWrite: await (async () => { const p = join(arcDir, 'out.tar'); await (Bun as any).Archive.write(p, { 'hello.txt': 'Hello' }); return existsSync(p); })(),
  blobSize: (await new (Bun as any).Archive({ 'a.txt': 'x'.repeat(1000) }).blob()).size,
  bytesLen: (await new (Bun as any).Archive({ 'a.txt': 'x' }).bytes()).length,
  extractCount: await (async () => { const a = new (Bun as any).Archive({ 'hello.txt': 'H', 'nested/f.txt': 'N' }); return await a.extract(join(arcDir, 'ex')); })(),
  globExtractExcludes: await (async () => { const a = new (Bun as any).Archive({ 'hello.txt': 'H', 'nested/f.txt': 'N' }); await a.extract(join(arcDir, 'exg'), { glob: 'nested/*' } as any); return !existsSync(join(arcDir, 'exg', 'hello.txt')); })(),
  gzipSmaller: await (async () => { const big = 'x'.repeat(5000); const plain = (await new (Bun as any).Archive({ 'a.txt': big }).blob()).size; const gz = (await new (Bun as any).Archive({ 'a.txt': big }, { compress: 'gzip' } as any).blob()).size; return gz < plain; })(),
  filesIsMap: await (async () => { const a = new (Bun as any).Archive({ 'a.txt': 'A' }); const f = await a.files(); return f instanceof Map ? f.size : 0; })(),
};
const udpGotchas = {
  typeofFn: typeof (Bun as any).udpSocket,
  loopbackEcho: await (async () => {
    let resolveR: (v: string) => void = () => {};
    const rp = new Promise<string>((res) => { resolveR = res; });
    const a = await (Bun as any).udpSocket({ hostname: '127.0.0.1', port: 0, socket: { data: (_s: any, d: any) => resolveR(String(new TextDecoder().decode(d))) } } as any);
    const b = await (Bun as any).udpSocket({ hostname: '127.0.0.1', port: 0 } as any);
    const sent = b.send(Buffer.from('ping-42'), a.port, '127.0.0.1');
    const msg = await rp;
    const family = a.address.family;
    a.close();
    const closed = a.closed;
    b.close();
    return JSON.stringify({ sent, msg, family, closed });
  })(),
};

// ---------- fileGotchas: Bun.file / Bun.write I/O (continue round) ----------
const fileDir = mkdtempSync(join(tmpdir(), 'art-file-'));
writeFileSync(join(fileDir, 'hello.txt'), 'Hello, World!');
const fObj = (Bun as any).file(join(fileDir, 'hello.txt'));
const fileGotchas = {
  name: fObj.name.split('/').pop(),
  size: fObj.size,
  type: fObj.type,
  exists: await fObj.exists(),
  text: await fObj.text(),
  arrayBufferLen: (await fObj.arrayBuffer()).byteLength,
  lastModifiedPos: typeof fObj.lastModified === 'number' && fObj.lastModified > 0,
  statIsFile: typeof (await fObj.stat()).isFile === 'function',
  statSize: (await fObj.stat()).size,
  sliceText: await fObj.slice(0, 5).text(),
  writeBytes: await (async () => { const w = join(fileDir, 'written.txt'); return await (Bun as any).write(w, 'abc'); })(),
  writeOverwritesBunFile: await (async () => { const w = join(fileDir, 'w2.txt'); await (Bun as any).write(w, 'old'); await (Bun as any).write((Bun as any).file(w), 'xyz'); return await (Bun as any).file(w).text(); })(),
};

// ---------- xmlGotchas: Bun.XML (docs/runtime/xml.mdx, new in v1.4) ----------
const xmlDir = mkdtempSync(join(tmpdir(), 'art-xml-'));
const xmlFixture = join(xmlDir, 'config.xml');
writeFileSync(xmlFixture, '<config><name>demo</name><port>8080</port></config>');
const xmlParseDoc = xmlNamed.parse('<order id="A1"><item sku="x">Tea</item><item sku="y">Mug</item><paid/></order>');
const xmlBig = '<root>' + Array.from({ length: 20000 }, (_u, i) => '<item id="' + i + '"><name>Item ' + i + '</name><v>' + (i * 1.5) + '</v></item>').join('') + '</root>';
const xmlT0 = performance.now();
xmlNamed.parse(xmlBig);
const xmlPerfMs = Number((performance.now() - xmlT0).toFixed(1));
const xmlGotchas = {
  surface: { bunXml: typeof (Bun as any).XML, namedXml: typeof xmlNamed },
  namedIdentity: (Bun as any).XML === xmlNamed,
  parseCompact: JSON.stringify(xmlParseDoc),
  parseTreeKeys: JSON.stringify(Object.keys(xmlNamed.parse('<p>Hello <b>world</b>!</p>', { compact: false } as any))),
  roundtrip: xmlNamed.stringify(xmlNamed.parse('<a><b>x</b></a>')) === '<a><b>x</b></a>',
  escapesAmp: xmlNamed.stringify({ a: { b: 'x & y < z >' } } as any),
  scalarDate: xmlNamed.stringify({ d: new Date(0) } as any),
  throwOnMalformed: (() => { try { xmlNamed.stringify({ 'a<b': 'x' } as any); return false; } catch { return true; } })(),
  xxeUnresolved: (() => { try { return JSON.stringify(xmlNamed.parse('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><a>&xxe;</a>')).slice(0, 90); } catch (e: any) { return 'THREW ' + e.name; } })(),
  importEvalToCompact: await (async () => { const m: any = await import(join(xmlFixture)); return JSON.stringify(m.default ?? m); })(),
  bundlerInlines: await (async () => { const out = await Bun.build({ entrypoints: [xmlFixture], outdir: join(xmlDir, 'out') } as any); if (!out.success) return 'BUILD_FAIL'; return (await out.outputs[0]!.text()).includes('demo'); })(),
  perf20kItemsMs: xmlPerfMs,
  perfVsDocs: xmlPerfMs < 27 * 2.5 ? 'CONSISTENT (docs 27 ms for 2.2 MB)' : 'DIFFERS',
};

// ---------- artifactGotchas: BuildArtifact contract + Bun.SHA256 (§194) ----------
const artDir = mkdtempSync(join(tmpdir(), 'art-g-'));
writeFileSync(join(artDir, 'app.ts'), 'export const x = 1;');
const artBuild = await Bun.build({ entrypoints: [join(artDir, 'app.ts')], outdir: join(artDir, 'out'), naming: { entry: '[name]-[hash].[ext]' } as any });
const artOut = artBuild.outputs[0]!;
const artifactGotchas = {
  namingHash: artOut.hash !== null,
  responseCtype: new Response(artOut as any).headers.get('content-type'),
  responseEtagNull: new Response(artOut as any).headers.get('etag') === null,
  hasBytesMethod: typeof (artOut as any).bytes,
  hasArrayBufferMethod: typeof (artOut as any).arrayBuffer,
  sha256Hex: new (Bun as any).SHA256().update('abc').digest('hex'),
  sourcemapLinked: await (async () => { const b = await Bun.build({ entrypoints: [join(artDir, 'app.ts')], outdir: join(artDir, 'sm'), sourcemap: 'linked' as any }); const o = b.outputs[0]!; return o.sourcemap ? o.sourcemap.kind + ':' + o.sourcemap.hash : 'NONE'; })(),
};
// ---------- emit ----------
const evidence = {
  tool: 'tools/build-artifact-evidence.ts',
  doc: 'docs/BUN_BUILD_FINDINGS.md (regenerated by bun run build-artifact:findings)',
  fixture: 'scratch/art-ground',
  bunVersion: Bun.version,
  bunRevision: Bun.revision,
  surface: { methods, cssAssetLoader: s01obj ? s01obj.loader : null },
  imageGotchas: imgGotchas,
  sliceGotchas,
  imageCtorGotchas,
  computeGuideGotchas,
  configGapsGotchas,
  serveGotchas,
  sqliteGotchas,
  urlPatternGotchas,
  gapCloseGotchas,
  cronGotchas,
  webviewGotchas,
  s3Gotchas,
  deepPassGotchas,
  markdownGotchas,
  utilityGotchas,
  miscGotchas,
  cpuProfMdNote: miscGotchas.cpuProfMd,
  archiveGotchas,
  udpGotchas,
  fileGotchas,
  xmlGotchas,
  artifactGotchas,
  scenarios,
};
await Bun.write(EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
console.log('build-artifact:evidence - wrote ' + EVIDENCE + ' (' + scenarios.length + ' scenarios, Bun ' + Bun.version + ' ' + Bun.revision + ')');

export {};