/**
 * JSON artifact IO — native `Bun.file().json()` + `Bun.write`.
 *
 * Centralizes read/write of JSON artifacts so callers never hand-roll
 * `JSON.parse(await Bun.file(p).text())`. `readJsonFileOr` covers the
 * missing/corrupt-artifact fallback pattern used across tools.
 *
 * @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
 * @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
 */

export async function readJsonFile<T = unknown>(path: string): Promise<T> {
  return (await Bun.file(path).json()) as T;
}

export async function readJsonFileOr<T>(path: string, fallback: T | null): Promise<T | null> {
  if (!(await Bun.file(path).exists())) return fallback;
  try {
    return await readJsonFile<T>(path);
  } catch {
    return fallback;
  }
}

export async function writeJsonFile(
  path: string,
  value: unknown,
  pretty = true,
): Promise<void> {
  const text = pretty ? JSON.stringify(value, null, 2) + "\n" : JSON.stringify(value);
  await Bun.write(path, text);
}
