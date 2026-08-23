// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { redactSecrets } from "../../src/lib/redact.ts";
import { inspectRedacted, inspectValue } from "../../src/institutions/terminal-utils.ts";

describe("redactSecrets", () => {
  test("redacts nested password/token/secret keys", () => {
    const input = { id: 1, password: "hunter2", metadata: { apiToken: "sk-live_123" } };
    const out = redactSecrets(input);
    expect(out.password).toBe("🔒 REDACTED");
    expect(out.metadata.apiToken).toBe("🔒 REDACTED");
    expect(out.id).toBe(1);
  });

  test("never mutates the input", () => {
    const input = { password: "hunter2", nested: { secret: "x" } };
    redactSecrets(input);
    expect(input.password).toBe("hunter2");
    expect(input.nested.secret).toBe("x");
  });

  test("handles arrays, Dates, and circular refs", () => {
    const d = new Date();
    const input: Record<string, unknown> = { list: [{ token: "t" }], when: d };
    (input as Record<string, unknown>).self = input;
    const out = redactSecrets(input) as { list: Array<{ token: string }>; when: Date; self: unknown };
    expect(out.list[0].token).toBe("🔒 REDACTED");
    expect(out.when).toBe(d);
    expect(out.self).toBe("[Circular]");
  });
});

describe("inspectRedacted", () => {
  test("inspect output contains marker, never the secret", () => {
    const out = inspectRedacted({ password: "hunter2" }, { colors: false });
    expect(out).toContain("🔒 REDACTED");
    expect(out).not.toContain("hunter2");
  });
});

describe("inspectValue verbose", () => {
  test("verbose=true full depth + colors; verbose=false compact plain", () => {
    const deep = { a: { b: { c: { d: 1 } } } };
    expect(inspectValue(deep, { verbose: true })).not.toContain("[Object ...]");
    expect(inspectValue(deep, { verbose: true })).toContain("\u001b[");
    expect(inspectValue(deep, { verbose: false })).toContain("[Object ...]");
    expect(inspectValue(deep, { verbose: false })).not.toContain("\u001b[");
  });
});
