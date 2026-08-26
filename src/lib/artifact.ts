/**
 * artifact.ts — the uniform artifact contract for everything we serve or validate:
 * frontend bundles, manifests, tiles, XML configs. Grounded facts (§194):
 *   - entry naming { entry: '[name]-[hash].[ext]' } makes hash non-null (BA-namingHash);
 *   - new Response(artifact) sets Content-Type but NOT ETag from hash (PINNED - you
 *     must set the ETag header yourself; BA-response);
 *   - sourcemap: 'linked' gives a nested BuildArtifact whose hash is a '00000000'
 *     placeholder (BA-sourcemapNested);
 *   - Bun.SHA256 exists and equals CryptoHasher sha256 output (BA-sha256).
 */
import type { BunFile } from 'bun';

export type ArtifactKind = 'entry-point' | 'chunk' | 'asset' | 'sourcemap' | 'bytecode' | 'tile' | 'manifest';

/** The uniform artifact contract (subset of BuildArtifact + derived artifacts). */
export interface Artifact {
  kind: ArtifactKind;
  path: string;
  hash: string | null; // strong ETag value (without quotes) or null
  size: number;
  type: string;
  sourcemap: Artifact | null;
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
  bytes(): Promise<Uint8Array>; // helper over arrayBuffer (BuildArtifact has NO .bytes() on 1.4.0 - BA-methods pin)
  stream(): ReadableStream;
}

/** Wrap a Bun.build output as an Artifact. */
export function fromBuildOutput(output: { kind: string; path: string; hash: string | null; size: number; type: string; sourcemap: unknown }): Artifact {
  const sm = output.sourcemap as { kind: string; path: string; hash: string | null; size: number; type: string } | null;
  const base = output as unknown as { text(): Promise<string>; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer>; stream(): ReadableStream };
  const art: Artifact = {
    kind: output.kind as ArtifactKind,
    path: output.path,
    hash: output.hash,
    size: output.size,
    type: output.type,
    sourcemap: null,
    text: base.text.bind(base),
    json: base.json.bind(base),
    arrayBuffer: base.arrayBuffer.bind(base),
    bytes: async () => new Uint8Array(await base.arrayBuffer()),
    stream: base.stream.bind(base),
  };
  art.sourcemap = sm ? { kind: sm.kind as ArtifactKind, path: sm.path, hash: sm.hash, size: sm.size, type: sm.type, sourcemap: null, text: base.text.bind(base), json: base.json.bind(base), arrayBuffer: base.arrayBuffer.bind(base), bytes: async () => new Uint8Array(await base.arrayBuffer()), stream: base.stream.bind(base) } : null;
  return art;
}

/** Strong ETag value for an artifact with a real hash (null -> undefined). */
export function etagFor(artifact: Pick<Artifact, 'hash'>): string | undefined {
  return artifact.hash ? '"' + artifact.hash + '"' : undefined;
}

/**
 * new Response(artifact) does NOT set ETag from hash on 1.4.0 (BA-response pin) -
 * this helper builds the response with the strong ETag set explicitly.
 */
export function responseFor(artifact: Artifact, opts: { cache?: string; status?: number } = {}): Response {
  const headers: Record<string, string> = { 'Content-Type': artifact.type };
  const etag = etagFor(artifact);
  if (etag) headers['ETag'] = etag;
  if (opts.cache) headers['Cache-Control'] = opts.cache;
  return new Response(artifact as unknown as BodyInit, { status: opts.status ?? 200, headers });
}

/** SHA-256 hex of bytes via Bun.SHA256 (grounded: equals CryptoHasher sha256). */
export function sha256Hex(bytes: Uint8Array | string): string {
  return new Bun.SHA256().update(bytes).digest('hex');
}

/** Wrap a BunFile (tiles, manifests, XML feeds) as an Artifact with a computed hash. */
export async function fromBunFile(file: BunFile, kind: ArtifactKind, opts: { computeHash?: boolean } = {}): Promise<Artifact> {
  const bytes = await file.bytes();
  return {
    kind,
    path: file.name ?? '',
    hash: opts.computeHash ? sha256Hex(bytes) : null,
    size: file.size,
    type: file.type,
    sourcemap: null,
    text: () => file.text(),
    json: () => file.json(),
    arrayBuffer: () => file.arrayBuffer(),
    bytes: async () => bytes,
    stream: () => file.stream(),
  };
}