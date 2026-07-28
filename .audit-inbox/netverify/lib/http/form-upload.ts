// @see https://bun.com/docs/runtime/hashing#bun-cryptohasher — Bun.CryptoHasher
// @see https://bun.com/docs/guides/http/file-uploads#upload-files-via-http-using-formdata — FormData upload
// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write — Bun.write
// @see https://bun.com/docs/runtime/networking/fetch#content-type-handling — FormData Content-Type
/**
 * HTTP file upload helpers (Bun FormData guide).
 *
 * Server (receive):
 *   1. `const form = await req.formData()`
 *   2. `const file = form.get("field")`  → string | File | Blob
 *   3. `await Bun.write(path, file)`     when it's a Blob/File
 *
 * Client (send):
 *   - `form.set("file", blob, "name.tgz")` or `form.set("file", file)`
 *   - Do **not** set Content-Type on fetch — Bun adds multipart boundary
 *
 * @see lib/http/content-type.ts for CT helpers
 */

/** True for Blob/File form fields (not plain strings). */
export function isFormBlob(value: FormDataEntryValue | null | undefined): value is Blob {
  return value != null && typeof value !== 'string' && value instanceof Blob;
}

/**
 * Extract a required file field from FormData.
 * Bun's guide treats uploads as `Blob`; `File` extends `Blob`.
 */
export function requireFormBlob(
  form: FormData,
  field = 'file'
): { ok: true; blob: Blob; filename: string } | { ok: false; error: string } {
  const value = form.get(field);
  if (value == null || value === '') {
    return { ok: false, error: `Missing form field "${field}"` };
  }
  if (typeof value === 'string') {
    return { ok: false, error: `Form field "${field}" must be a file, not a string` };
  }
  if (!(value instanceof Blob)) {
    return { ok: false, error: `Form field "${field}" is not a Blob/File` };
  }
  const filename =
    value instanceof File && value.name
      ? value.name
      : field === 'file'
        ? 'artifact.bin'
        : `${field}.bin`;
  return { ok: true, blob: value, filename };
}

/** Optional string field (trim empty → undefined). */
export function formString(form: FormData, field: string): string | undefined {
  const v = form.get(field);
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t || undefined;
}

/**
 * Persist upload to disk — same as Bun guide:
 *   await Bun.write("profilePicture.png", profilePicture)
 */
export async function writeFormBlob(path: string, blob: Blob): Promise<number> {
  // Bun.write creates parent directories for nested paths
  const written = await Bun.write(path, blob);
  return typeof written === 'number' ? written : blob.size;
}

/** SHA-256 hex of a Blob/File (for registry checksums). */
export async function sha256Blob(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const hash = new Bun.CryptoHasher('sha256');
  hash.update(bytes);
  return hash.digest('hex');
}

/**
 * Build multipart FormData for registry publish (client side).
 * Leaves Content-Type to Bun (multipart boundary).
 */
export function buildFileUploadForm(opts: {
  file: Blob;
  filename?: string;
  fields?: Record<string, string>;
}): FormData {
  const form = new FormData();
  const name = opts.filename ?? (opts.file instanceof File ? opts.file.name : 'upload.bin');
  form.set('file', opts.file, name);
  if (opts.fields) {
    for (const [k, v] of Object.entries(opts.fields)) {
      form.set(k, v);
    }
  }
  return form;
}
