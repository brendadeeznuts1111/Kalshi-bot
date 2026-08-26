/**
 * canonical-asset.ts — deterministic digital-asset tuple from any image file:
 * processed PNG bytes + SHA-256 asset hash + canonicalized metadata + digest.
 *
 * Grounded on Bun 1.4.0 (docs + runtime probes + pinned bun-types; AGENT-PITFALLS §190):
 *   - Bun.file(path).image() is a SYNC factory — do not await it; terminals
 *     (.bytes()/.write()/...) are the awaited operations (bun.com/docs/runtime/image).
 *   - .resize(w, h, { fit }) accepts ONLY "fill" | "inside" — "cover"/"contain"/
 *     "outside" throw ERR_INVALID_ARG_TYPE (probe-verified; bun-types 1.4.0
 *     ImageResizeOptions.fit is "fill" | "inside"). This module therefore
 *     types fit as those two and defaults to "inside".
 *   - .png().bytes() is a terminal (format selector + bytes).
 *   - Bun.CryptoHasher.hash(alg, input, "hex") static exists; input may be a
 *     string or a Uint8Array (buffer passed directly — no intermediate JS
 *     string; content-pipeline §24 measured buffer-vs-string parity on 100MB).
 *   - The static returns a hex string; digest() on an instance returns a
 *     Buffer ("hex"/"base64" encodings work, "arraybuffer" throws — §24).
 *
 * Determinism contract: given the same bytes + metadata inputs, the tuple is
 * byte-identical across runs and machines — keys are sorted, floats become
 * fixed-point strings, arrays can be sorted, and the timestamp is explicit
 * (epoch 0 fallback warns — a changing timestamp changes the digest by design).
 *
 * @see https://bun.com/docs/runtime/image (chainable pipeline, fit, terminals)
 * @see https://bun.com/reference/bun/CryptoHasher (static hash overloads)
 */

export interface CanonicalAsset {
  /** SHA-256 of the processed image bytes (0x-prefixed hex). */
  assetHash: string;
  /** SHA-256 of the normalized, sorted metadata JSON (0x-prefixed hex). */
  metadataDigest: string;
  /** Normalized, deterministically key-sorted metadata object (off-chain storage). */
  metadata: Record<string, any>;
  /** Processed PNG payload bytes. */
  processedImage: Uint8Array;
}

export type CanonicalFit = "inside" | "fill";

/** Recursively sorts object keys and (optionally) arrays deterministically. */
export function sortObjectKeys(obj: any, sortArrays = false): any {
  if (obj === null || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    const sortedItems = obj.map((item) => sortObjectKeys(item, sortArrays));
    if (sortArrays) {
      // Deterministic typed-key order — NOT localeCompare (locale/ICU-dependent
      // and punctuation-ignoring, so not canonical across environments).
      // Order: null, booleans, numbers (numeric), strings, objects (canonical JSON).
      return sortedItems.sort((a, b) => {
        const ka = sortKey(a);
        const kb = sortKey(b);
        if (ka !== kb) return ka < kb ? -1 : 1;
        if (typeof a === "number" && typeof b === "number") return a - b;
        return 0;
      });
    }
    return sortedItems;
  }

  return Object.keys(obj)
    .sort()
    .reduce((acc: Record<string, any>, key) => {
      acc[key] = sortObjectKeys(obj[key], sortArrays);
      return acc;
    }, {});
}

/** Typed sort prefix for array ordering (null < bool < number < string < object). */
function sortKey(v: any): string {
  if (v === null || v === undefined) return "0";
  const t = typeof v;
  if (t === "boolean") return "1" + (v ? "1" : "0");
  if (t === "number") return "2";
  if (t === "string") return "3" + v;
  return "4" + JSON.stringify(sortObjectKeys(v, true));
}

/**
 * Non-integer numbers -> fixed-precision strings for reproducible JSON across
 * platforms (toFixed never emits exponent notation; trailing zeros stripped).
 * Integers pass through untouched. Guards: non-finite and |n| >= 1e21 keep the
 * number (toFixed would throw RangeError at 1e21; -0 serializes as 0 anyway).
 */
export function normalizeNumbers(obj: any, precision = 10): any {
  if (obj === null || typeof obj !== "object") {
    if (typeof obj === "number" && !Number.isInteger(obj)) {
      if (!Number.isFinite(obj) || Math.abs(obj) >= 1e21) return obj;
      return obj.toFixed(precision).replace(/\.?0+$/, "");
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((v) => normalizeNumbers(v, precision));
  }

  const result: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    result[key] = normalizeNumbers(obj[key], precision);
  }
  return result;
}

export type CanonicalAssetOptions = {
  name?: string;
  description?: string;
  width?: number;
  height?: number;
  /** Bun 1.4.0 supports only "inside" | "fill" (probe + bun-types) — default "inside". */
  fit?: CanonicalFit;
  schema?: string;
  /** Explicit timestamp (ms). Omitted -> epoch 0 with a warning (determinism). */
  timestamp?: number;
  sortArrays?: boolean;
  normalizeNumbers?: boolean;
  numberPrecision?: number;
  extra?: Record<string, any>;
};

/**
 * Generate the canonical asset tuple: process image -> PNG, hash the bytes,
 * build + canonicalize metadata, digest the metadata JSON.
 */
export async function generateCanonicalAsset(
  imagePath: string,
  options: CanonicalAssetOptions = {},
): Promise<CanonicalAsset> {
  const width = options.width ?? 1024;
  const height = options.height ?? 1024;
  const fit = options.fit ?? "inside";
  const shouldNormalize = options.normalizeNumbers !== false;
  const precision = options.numberPrecision ?? 10;

  // Deterministic timestamp: explicit input required for reproducible digests.
  const timestamp = options.timestamp ?? (() => {
    console.warn("canonical-asset: no timestamp provided — using epoch 0. Pass an explicit timestamp for deterministic digests.");
    return 0;
  })();

  const file = Bun.file(imagePath);
  if (!(await file.exists())) {
    throw new Error("File not found: " + imagePath);
  }

  // file.image() is a sync factory — await only the terminal (.bytes()).
  let processedBuffer: Uint8Array;
  try {
    const img = file.image();
    processedBuffer = await img.resize(width, height, { fit }).png().bytes();
  } catch (err: any) {
    throw new Error("Failed to process image payload: " + (err?.message ?? err));
  }

  // Static one-shot hash over the raw bytes (buffer passed directly).
  const assetHash = Bun.CryptoHasher.hash("sha256", processedBuffer, "hex") as string;

  const rawMetadata = {
    asset_hash: "0x" + assetHash,
    version: "1.0.0",
    created_at: timestamp,
    schema: options.schema ?? "canonical-asset/v1",
    name: options.name ?? "Unnamed Asset",
    description: options.description ?? "",
    ...(options.extra ?? {}),
  };

  // Float normalization BEFORE key sorting, then deterministic key/array order.
  const normalized = shouldNormalize ? normalizeNumbers(rawMetadata, precision) : rawMetadata;
  const sortedMetadata = sortObjectKeys(normalized, options.sortArrays ?? false);
  const metadataJson = JSON.stringify(sortedMetadata);
  const metadataDigest = Bun.CryptoHasher.hash("sha256", metadataJson, "hex") as string;

  return {
    assetHash: "0x" + assetHash,
    metadataDigest: "0x" + metadataDigest,
    metadata: sortedMetadata,
    processedImage: processedBuffer,
  };
}