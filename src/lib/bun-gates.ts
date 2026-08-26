/**
 * Gate-coverage map for the Bun shape (shared by the coverage matrix
 * generator and the per-module shape report, §169/§170): token -> probe
 * gate. Keys are shape member names; dead keys (absent from the shape)
 * fail the matrix generator. gateFor() applies namespace inheritance
 * (a sub-namespace member is covered by its namespace's gate).
 */
export const GATES: Record<string, string> = {
  file: "fs:probe", write: "fs:probe", mmap: "fs:probe", stdout: "fs:probe",
  gzipSync: "fs:probe", gunzipSync: "fs:probe", deflateSync: "fs:probe", inflateSync: "fs:probe",
  zstdCompressSync: "fs:probe", zstdDecompressSync: "fs:probe", zstdCompress: "fs:probe", zstdDecompress: "fs:probe", Archive: "fs:probe",
  "$": "shell:probe", semver: "bun:apis-probe", JSON5: "bun:apis-probe", sha: "bun:apis-probe",
  spawn: "spawn:probe", spawnSync: "spawn:probe", build: "build-deep:probe", plugin: "build-deep:probe",
  serve: "serve-tls/routes", fetch: "serve-tls/routes", sql: "sqlite:probe", SQL: "sqlite:probe",
  cron: "cron tests §126/128",
  color: "ansi:probe", inspect: "ansi:probe", escapeHTML: "ansi:probe", stringWidth: "ansi:probe", stripANSI: "ansi:probe", sliceAnsi: "ansi:probe", wrapAnsi: "ansi:probe",
  CryptoHasher: "crypto:probe", SHA256: "crypto:probe", hash: "crypto:probe", deepEquals: "crypto:probe", randomUUIDv7: "crypto:probe",
  Image: "image:probe", markdown: "format:probe", XML: "format:probe", TOML: "format:probe", JSONL: "format:probe", YAML: "format:probe", JSONC: "format:probe",
  Glob: "fsx:probe", which: "fsx:probe", resolve: "fsx:probe", fileURLToPath: "fsx:probe", pathToFileURL: "fsx:probe", openInEditor: "fsx:probe",
  connect: "security:probe", CSRF: "csrf:probe", Cookie: "defaults:probe", CookieMap: "defaults:probe",
  listen: "net:probe", udpSocket: "net:probe", dns: "net:probe", redis: "net:probe", secrets: "net:probe",
  env: "runtime:probe", argv: "runtime:probe", sleep: "runtime:probe", version: "runtime:probe", revision: "runtime:probe", nanoseconds: "runtime:probe",
  peek: "runtime:probe", readableStreamToArrayBuffer: "runtime:probe", readableStreamToText: "runtime:probe", readableStreamToFormData: "runtime:probe", sleepSync: "runtime:probe", version_with_sha: "runtime:probe", ArrayBufferSink: "runtime:probe", Transpiler: "runtime:probe", Terminal: "runtime:probe", WebView: "runtime:probe",
  MD4: "surface:probe", MD5: "surface:probe", SHA1: "surface:probe", SHA224: "surface:probe", SHA384: "surface:probe", SHA512: "surface:probe", SHA512_256: "surface:probe",
  password: "surface:probe", FileSystemRouter: "surface:probe", deepMatch: "surface:probe", concatArrayBuffers: "surface:probe",
  gc: "surface:probe", shrink: "surface:probe", generateHeapSnapshot: "surface:probe", isMainThread: "surface:probe", isStandaloneExecutable: "surface:probe", main: "surface:probe", unsafe: "surface:probe",
  indexOfLine: "surface:probe", resolveSync: "surface:probe", allocUnsafe: "surface:probe", embeddedFiles: "surface:probe", stderr: "surface:probe", stdin: "surface:probe",
  postgres: "client-shape:probe", RedisClient: "client-shape:probe", s3: "client-shape:probe", S3Client: "client-shape:probe",
  randomUUIDv5: "surface:probe", readableStreamToArray: "surface:probe", readableStreamToBlob: "surface:probe", readableStreamToBytes: "surface:probe", readableStreamToJSON: "surface:probe",
  enableANSIColors: "ecosystem:probe", FFI: "ffi:probe",
  BuildArtifact: "build-artifact:probe", BuildConfig: "build-artifact:probe",
};

/** Gate for a shape member: own entry, else namespace inheritance, else GAP. */
export function gateFor(m: { name: string; ns: string }): string {
  return GATES[m.name] ?? (m.ns ? GATES[m.ns] + " (ns)" : "GAP");
}