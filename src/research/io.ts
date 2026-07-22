// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
/** Bun.file / Bun.write helpers for artifacts. */

export async function writeJson(path: string, value: unknown): Promise<number> {
  return Bun.write(path, JSON.stringify(value, null, 2));
}

export async function readJsonFile<T>(path: string): Promise<T | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  try {
    return (await file.json()) as T;
  } catch {
    return null;
  }
}

export function decodeBase64(content: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(content), (c) => c.charCodeAt(0)));
}
