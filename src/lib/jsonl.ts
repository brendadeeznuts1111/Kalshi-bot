/**
 * Bun-native JSONL helpers — streaming, skip-and-continue, zero deps.
 *
 * ## Verified Bun.JSONL semantics (bun 1.3.14, empirical)
 *
 * | API | Behavior |
 * | --- | -------- |
 * | `Bun.JSONL.parse(text|bytes)` | All values for clean input. On the FIRST invalid line it returns the values parsed BEFORE the error and silently drops the tail — it does **not** skip bad lines. Throws `SyntaxError` only when nothing parsed. Skips UTF-8 BOM. |
 * | `Bun.JSONL.parseChunk(bytes)` | `{ values, read, done, error }`, never throws. On a bad line: `values` = records before the error, `read` points just before the bad line, `error` set, `done=false`. On a clean chunk: `read` consumes records but leaves the trailing `\n` in the remainder. |
 *
 * More mechanics (verified): `read` is UTF-8 **bytes** even for string input (so
 * never `buffer.slice(read)` on a string with multibyte chars); the naive
 * `buffer.slice(read)` pattern loops forever on a bad line because `read`
 * never advances past the error; `subarray()` is zero-copy but retains the
 * parent `ArrayBuffer` (bounded here — the parent is released on the next
 * feed's concat). Feed `Uint8Array` (or strings, encoded internally).
 *
 * The helpers below restore repo semantics (**skip-and-continue**, surface
 * errors with line numbers) on top of the C++ parser, and add byte-offset
 * streaming for large files (live-tracker logs, WS captures).
 *
 * @see https://bun.com/docs/api/jsonl
 * @see docs/BUN_NATIVE.md
 */

export type JsonlError = {
  /** 1-based line number (blank lines included) of the offending line. */
  line: number;
  message: string;
  /** Raw line text (trimmed, capped). */
  raw: string;
};

export type JsonlParseOptions = {
  onError?: (err: JsonlError) => void;
};

function decodeLine(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).trim();
}

function parseLine(lineBytes: Uint8Array, line: number, onError?: (e: JsonlError) => void): unknown[] {
  const raw = decodeLine(lineBytes);
  if (!raw) return [];
  try {
    // Single JSONL line → exactly one value; reject multi-value lines.
    const values = Bun.JSONL.parse(lineBytes) as unknown[];
    if (values.length !== 1) {
      throw new SyntaxError(`expected 1 value per line, got ${values.length}`);
    }
    return values;
  } catch (cause) {
    const err: JsonlError = {
      line,
      message: cause instanceof Error ? cause.message : String(cause),
      raw: raw.slice(0, 200),
    };
    onError?.(err);
    return [];
  }
}

/**
 * Parse a JSONL string with skip-and-continue: bad lines are reported (via
 * `opts.onError` or the returned errors) and parsing continues past them —
 * unlike raw `Bun.JSONL.parse`, which truncates at the first bad line.
 */
export function parseJsonlText<T = unknown>(
  text: string,
  opts: JsonlParseOptions = {}
): { values: T[]; errors: JsonlError[] } {
  const errors: JsonlError[] = [];
  const values: T[] = [];
  const enc = new TextEncoder();
  let line = 0;
  for (const rawLine of text.split('\n')) {
    line++;
    const parsed = parseLine(enc.encode(rawLine), line, (e) => errors.push(e));
    values.push(...(parsed as T[]));
  }
  return { values, errors };
}

/**
 * Streaming JSONL parser over arbitrary byte chunks, built on
 * `Bun.JSONL.parseChunk` with byte-offset carry. Never loads the whole
 * input; skip-and-continue across chunk boundaries.
 *
 * Usage:
 * ```ts
 * const p = new JsonlChunkParser<MyRow>();
 * for await (const chunk of file.stream()) p.feed(new Uint8Array(chunk));
 * const values = p.finish(); // all accumulated values
 * ```
 */
export class JsonlChunkParser<T = unknown> {
  readonly errors: JsonlError[] = [];
  private readonly all: T[] = [];
  private buf = new Uint8Array(0);
  private line = 0;
  private finished = false;

  constructor(private readonly opts: JsonlParseOptions = {}) {}

  private countNewlines(bytes: Uint8Array): void {
    for (const b of bytes) if (b === 0x0a) this.line++;
  }

  /**
   * Feed a chunk (`Uint8Array` preferred; strings are UTF-8 encoded — note
   * Bun.JSONL's `read` is in UTF-8 **bytes** for both, so never mix with
   * `string.slice` on multibyte content). Values are accumulated internally —
   * `finish()` returns the complete list; this method also returns the values
   * completed by this chunk for incremental callers.
   */
  feed(chunk: Uint8Array | string): T[] {
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
    const next = new Uint8Array(this.buf.length + bytes.length);
    next.set(this.buf, 0);
    next.set(bytes, this.buf.length);
    this.buf = next;
    const out = this.drain();
    this.all.push(...out);
    return out;
  }

  private drain(): T[] {
    const out: T[] = [];
    for (;;) {
      // Blank lines are legal JSONL; strip leading separators before parsing.
      let lead = 0;
      while (lead < this.buf.length && (this.buf[lead] === 0x0a || this.buf[lead] === 0x0d)) lead++;
      if (lead) {
        this.line += lead; // count skipped blank lines
        this.buf = this.buf.subarray(lead); // zero-copy view into the current chunk buffer
      }
      if (!this.buf.length) break;

      const res = Bun.JSONL.parseChunk(this.buf) as {
        values: unknown[];
        read: number;
        done: boolean;
        error?: unknown;
      };
      this.line += this.countNewlinesSafe(res.read);
      for (const v of res.values) out.push(v as T);

      if (res.error) {
        // parseChunk stops at the bad line with `read` sitting on the
        // newline that terminated the last good record. The bad line starts
        // after any leading newline(s); record it, consume it, keep going.
        let start = res.read;
        let skipped = 0;
        while (start < this.buf.length && (this.buf[start] === 0x0a || this.buf[start] === 0x0d)) {
          start++;
          skipped++;
        }
        const idx = this.buf.indexOf(0x0a, start);
        const end = idx === -1 ? this.buf.length : idx;
        // Terminators that completed good records (before the bad line).
        this.line += skipped;
        const err: JsonlError = {
          line: this.line + 1,
          message: res.error instanceof Error ? res.error.message : String(res.error),
          raw: decodeLine(this.buf.slice(start, end)).slice(0, 200),
        };
        this.errors.push(err);
        this.opts.onError?.(err);
        const consumed = idx === -1 ? this.buf.length : idx + 1;
        this.countNewlines(this.buf.slice(0, consumed));
        this.buf = this.buf.subarray(consumed); // zero-copy skip of the bad line
        continue;
      }

      // Clean region: carry the remainder (parseChunk leaves the trailing
      // newline of the last consumed record in the remainder). subarray is a
      // zero-copy view; the parent chunk buffer is released on the next feed.
      this.buf = this.buf.subarray(res.read);
      if (res.done && this.buf.length === 0) break;
      // If nothing advanced (defensive), stop to avoid a live loop.
      if (res.read === 0 && this.buf.length) break;
    }
    return out;
  }

  /**
   * Terminal: parse whatever remains (final partial line with no trailing
   * newline) and return ALL accumulated values. Subsequent calls return [].
   */
  finish(): T[] {
    if (this.finished) return [];
    const tail = this.drain();
    this.all.push(...tail);
    if (this.buf.length) {
      this.line++;
      const parsed = parseLine(this.buf, this.line, (e) => this.errors.push(e));
      this.all.push(...(parsed as T[]));
      this.buf = new Uint8Array(0);
    }
    this.finished = true;
    return this.all;
  }

  private countNewlinesSafe(n: number): number {
    let c = 0;
    for (let i = 0; i < n && i < this.buf.length; i++) if (this.buf[i] === 0x0a) c++;
    return c;
  }
}

export type JsonlFileResult<T> = {
  values: T[];
  errors: JsonlError[];
  bytes: number;
};

/**
 * Stream a JSONL file from disk with `Bun.file().stream()` + parseChunk —
 * memory-efficient for large captures (WS frames, tracker logs).
 */
export async function readJsonlFile<T = unknown>(
  path: string,
  opts: JsonlParseOptions = {}
): Promise<JsonlFileResult<T>> {
  const f = Bun.file(path);
  const parser = new JsonlChunkParser<T>(opts);
  const stream = f.stream();
  for await (const chunk of stream) {
    parser.feed(new Uint8Array(chunk));
  }
  const values = parser.finish();
  return { values, errors: parser.errors, bytes: f.size };
}

/** Append values as JSONL lines (append-only convention; callers fsync via Bun). */
export async function appendJsonl(path: string, values: unknown[]): Promise<void> {
  const lines = values.map((v) => JSON.stringify(v)).join('\n');
  await Bun.write(path, lines.endsWith('\n') ? lines : lines + '\n', { createPath: true });
}
