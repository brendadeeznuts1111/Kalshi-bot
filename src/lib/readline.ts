// @see https://bun.com/docs/runtime/utils#console-as-an-async-iterable
/**
 * Line input via the console AsyncIterable (for await (const line of console))
 * - no readline dependency. Injectable source for tests.
 */

/** The console object is an AsyncIterable over stdin lines. */
export const CONSOLE_LINES = console as unknown as AsyncIterable<string>;

export type LineInputOptions = {
  source?: AsyncIterable<string>;
  write?: (text: string) => void;
  /** Returned when the user submits an empty line (Enter with default). */
  default?: string;
  /** Abort with the default (or "") after N ms - never hang a script. */
  timeoutMs?: number;
};

/**
 * Read one line from the input source, optionally writing a prompt to stdout
 * (no trailing newline - like readline.question).
 */
export async function readLine(
  prompt?: string,
  options: LineInputOptions = {},
): Promise<string> {
  const source = options.source ?? CONSOLE_LINES;
  const write = options.write ?? ((text: string) => { void Bun.stdout.write(text); });
  if (prompt) write(prompt);
  for await (const line of source) {
    const t = String(line).trim();
    return t !== "" ? t : (options.default ?? "");
  }
  return options.default ?? "";
}

function withTimeout(read: Promise<string>, timeoutMs: number, fallback: string): Promise<string> {
  return Promise.race([
    read,
    new Promise<string>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

/**
 * Interactive yes/no confirm. Returns true for y/yes (case-insensitive),
 * false otherwise (including EOF or timeout).
 */
export async function confirmYes(
  prompt: string,
  options: LineInputOptions = {},
): Promise<boolean> {
  const read = readLine(prompt + " [y/N] ", options);
  const answer = options.timeoutMs != null
    ? await withTimeout(read, options.timeoutMs, "")
    : await read;
  return /^(y|yes)$/i.test(answer.trim());
}
