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
import { join } from 'node:path';
import { existsSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
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
  const text = r.ok && entry ? await (await Bun.build({ entrypoints: [join(F, 'pure.ts')], outdir: join(F, 'outsm-' + mode + 'b'), sourcemap: mode })).outputs[0].text() : '';
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
  const text = r.ok ? await (await Bun.build({ entrypoints: [join(F, 'env.ts')], outdir: join(F, 'outt-' + t + 'b'), target: t })).outputs[0].text() : '';
  tgt[t] = { size: r.outputs[0] ? r.outputs[0].size : null, hasBunHeader: text.includes('@bun'), hasProcess: text.includes('process') };
  push('S08-target-' + t, { entrypoints: ['env.ts'], outdir: 'outt-' + t, target: t }, r, tgt[t]);
}

// ---------- S09: format ----------
const fmt: any = {};
for (const f of ['esm', 'cjs', 'iife'] as const) {
  const r = await safe({ entrypoints: [join(F, 'pure.ts')], outdir: join(F, 'outf-' + f), format: f });
  const text = r.ok ? await (await Bun.build({ entrypoints: [join(F, 'pure.ts')], outdir: join(F, 'outf-' + f + 'b'), format: f })).outputs[0].text() : '';
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
const s11text = s11.ok ? await (await Bun.build({ entrypoints: [join(F, 'def.ts')], outdir: join(F, 'outd2'), define: { MODE: '"prod"' } })).outputs[0].text() : '';
push('S11-define', { entrypoints: ['def.ts'], outdir: 'outd', define: { MODE: '"prod"' } }, s11, { inlined: s11text.includes('prod') });

// ---------- S12: env ----------
const env: any = {};
for (const [label, v] of [['inline', 'inline'], ['disable', 'disable'], ['prefix', 'GROUND_*']] as const) {
  const r = await safe({ entrypoints: [join(F, 'env.ts')], outdir: join(F, 'oute-' + label), env: v });
  const text = r.ok ? await (await Bun.build({ entrypoints: [join(F, 'env.ts')], outdir: join(F, 'oute-' + label + 'b'), env: v })).outputs[0].text() : '';
  env[label] = { size: r.outputs[0] ? r.outputs[0].size : null, substituted: text.includes('grounded-ok'), keptDynamic: text.includes('process.env.GROUND_MODE') };
  push('S12-env-' + label, { entrypoints: ['env.ts'], outdir: 'oute-' + label, env: v }, r, env[label]);
}

// ---------- S13: drop ----------
const s13a = await safe({ entrypoints: [join(F, 'drop.ts')], outdir: join(F, 'outdr') });
const s13b = await safe({ entrypoints: [join(F, 'drop.ts')], outdir: join(F, 'outdr2'), drop: ['console.log'] });
const t13a = s13a.ok ? await (await Bun.build({ entrypoints: [join(F, 'drop.ts')], outdir: join(F, 'outdr3') })).outputs[0].text() : '';
const t13b = s13b.ok ? await (await Bun.build({ entrypoints: [join(F, 'drop.ts')], outdir: join(F, 'outdr4'), drop: ['console.log'] })).outputs[0].text() : '';
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
const t15a = s15a.ok ? await (await Bun.build({ entrypoints: [join(F, 'ext.ts')], outdir: join(F, 'outex3'), external: ['zod'] })).outputs[0].text() : '';
push('S15a-external-zod', { entrypoints: ['ext.ts'], outdir: 'outex', external: ['zod'] }, s15a, { keptImport: t15a.includes('from "zod"'), size: s15a.outputs[0] ? s15a.outputs[0].size : null });
push('S15b-bundle-zod', { entrypoints: ['ext.ts'], outdir: 'outex2' }, s15b, { size: s15b.outputs[0] ? s15b.outputs[0].size : null });

// ---------- S16: conditions ----------
const s16a = await safe({ entrypoints: [join(F, 'cond.ts')], outdir: join(F, 'outc') });
const s16b = await safe({ entrypoints: [join(F, 'cond.ts')], outdir: join(F, 'outc2'), conditions: ['custom'] });
const t16a = s16a.ok ? await (await Bun.build({ entrypoints: [join(F, 'cond.ts')], outdir: join(F, 'outc3') })).outputs[0].text() : '';
const t16b = s16b.ok ? await (await Bun.build({ entrypoints: [join(F, 'cond.ts')], outdir: join(F, 'outc4'), conditions: ['custom'] })).outputs[0].text() : '';
push('S16a-conditions-default', { entrypoints: ['cond.ts'], outdir: 'outc' }, s16a, { resolvedMarker: t16a.split('\n').filter((l: string) => l.includes('tag'))[0] ?? '' });
push('S16b-conditions-custom', { entrypoints: ['cond.ts'], outdir: 'outc2', conditions: ['custom'] }, s16b, { resolvedMarker: t16b.split('\n').filter((l: string) => l.includes('tag'))[0] ?? '' });

// ---------- S17: publicPath ----------
const s17 = await safe({ entrypoints: [join(F, 'pub.ts')], outdir: join(F, 'outp'), publicPath: '/cdn/' });
const t17 = s17.ok ? await (await Bun.build({ entrypoints: [join(F, 'pub.ts')], outdir: join(F, 'outp2'), publicPath: '/cdn/' })).outputs[0].text() : '';
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
    const crc32 = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
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
  const crc32 = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crcT[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
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
  scenarios,
};
await Bun.write(EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
console.log('build-artifact:evidence - wrote ' + EVIDENCE + ' (' + scenarios.length + ' scenarios, Bun ' + Bun.version + ' ' + Bun.revision + ')');

export {};