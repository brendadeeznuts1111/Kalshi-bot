// @see https://bun.com/docs/runtime/utils#console-as-an-async-iterable
/**
 * Line input via the console AsyncIterable (for await (const line of console))
 * - no readline dependency. Injectable source for tests.
 */

/** The console object is an AsyncIterable over stdin lines. */
export const CONSOLE_LINES = console as unknown as AsyncIterable<string>;

/**
 * Read one line from the input source, optionally writing a prompt to stdout
 * (no trailing newline - like readline.question).
 */
export async function readLine(
  prompt?: string,
  options: { source?: AsyncIterable<string>; write?: (text: string) => void } = {},
): Promise<string> {
  const source = options.source ?? CONSOLE_LINES;
  const write = options.write ?? ((text: string) => { void Bun.stdout.write(text); });
  if (prompt) write(prompt);
  for await (const line of source) {
    return String(line).trim();
  }
  return "";
}

/**
 * Interactive yes/no confirm. Returns true for y/yes (case-insensitive),
 * false otherwise (including EOF).
 */
export async function confirmYes(
  prompt: string,
  options: { source?: AsyncIterable<string>; write?: (text: string) => void } = {},
): Promise<boolean> {
  const answer = await readLine(prompt + " [y/N] ", options);
  return /^(y|yes)$/i.test(answer.trim());
}
