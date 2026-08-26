// Secret-leak audit (S219): repo-wide scan for plaintext-secret argv flags.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanSecretLeaks, secretLeakAuditPasses } from "../../src/lib/secret-leak-audit.ts";

function tmpRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "leak-"));
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
}

describe("scanSecretLeaks", () => {
  test("flags a secret VALUE argv flag (--api-token=sk-1)", () => {
    const root = tmpRepo({ "tools/evil.ts": "const t = process.argv.find(a => a.startsWith('--api-token='));\n" });
    const f = scanSecretLeaks(root);
    expect(f.length).toBe(1);
    expect(f[0]!.file).toContain("evil.ts");
    expect(f[0]!.flags).toContain("--api-token");
  });

  test("path-taking flags (--key-file, --pem) are NOT leaks", () => {
    const root = tmpRepo({ "tools/ok.ts": "const p = argValue('key-file');\nconst pem = flag('--pem');\n" });
    expect(secretLeakAuditPasses(scanSecretLeaks(root))).toBe(true);
  });

  test("clean repo passes", () => {
    const root = tmpRepo({ "tools/clean.ts": "const x = 1;\n" });
    expect(secretLeakAuditPasses(scanSecretLeaks(root))).toBe(true);
  });
});
