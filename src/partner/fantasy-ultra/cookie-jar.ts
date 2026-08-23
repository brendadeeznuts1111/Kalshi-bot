/**
 * Minimal cookie jar for Fantasy402 session hops.
 * Bun fetch does not persist Set-Cookie across calls.
 */

export class CookieJar {
  private readonly map = new Map<string, string>();

  /** Ingest one or more Set-Cookie header values. */
  absorb(setCookieHeaders: string[] | string | null | undefined): void {
    if (setCookieHeaders == null) return;
    const list = Array.isArray(setCookieHeaders)
      ? setCookieHeaders
      : [setCookieHeaders];
    for (const raw of list) {
      const first = raw.split(";")[0]?.trim();
      if (!first) continue;
      const eq = first.indexOf("=");
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (name) this.map.set(name, value);
    }
  }

  /** Absorb from a Response (handles getSetCookie if present). */
  absorbResponse(res: Response): void {
    const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
    if (typeof anyHeaders.getSetCookie === "function") {
      this.absorb(anyHeaders.getSetCookie());
      return;
    }
    const single = res.headers.get("set-cookie");
    if (single) this.absorb(single);
  }

  headerValue(): string | undefined {
    if (this.map.size === 0) return undefined;
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  /**
   * Compact + redacted print: console.log / Bun.inspect never leak cookie
   * values (session tokens) into logs.
   * @see https://bun.com/docs/runtime/utils#bun-inspect-custom
   */
  [Bun.inspect.custom](_depth: number, _options: unknown, _inspect: typeof Bun.inspect): string {
    return `CookieJar(${this.map.size} cookie${this.map.size === 1 ? "" : "s"})`;
  }
}
