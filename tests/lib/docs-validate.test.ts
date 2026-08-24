// Docs code-block validation via Bun.Transpiler (§59).
import { describe, expect, test } from "bun:test";
import { extractCodeBlocks, validateBlock, validateBlockByLanguage } from "../../src/lib/docs-validate.ts";

describe("extractCodeBlocks", () => {
  test("pulls tagged JS blocks with line numbers, skips untagged", () => {
    const md = "# T\n\n\x60\x60\x60ts\nconst x = 1;\n\x60\x60\x60\n\n```\ndiagram\n```\n\n\x60\x60\x60bash\necho hi\n\x60\x60\x60\n";
    const blocks = extractCodeBlocks(md, "t.md");
    expect(blocks).toHaveLength(3);
    expect(blocks[0]!.language).toBe("ts");
    expect(blocks[0]!.line).toBe(3);
  });
});

describe("validateBlock", () => {
  test("valid TS passes", () => {
    const v = validateBlock({ file: "a.md", language: "ts", code: "const x: number = 1;\nconsole.log(x);", line: 1 });
    expect(v.ok).toBe(true);
  });

  test("invalid syntax is caught", () => {
    const v = validateBlock({ file: "a.md", language: "ts", code: "const broken = ;", line: 1 });
    expect(v.ok).toBe(false);
    expect(v.error).toBeTruthy();
  });

  test("non-JS language is skipped", () => {
    const v = validateBlock({ file: "a.md", language: "bash", code: "echo hi", line: 1 });
    expect(v.ok).toBe(true);
    expect(v.error).toBeUndefined();
  });
});
describe("validateBlockByLanguage (bash)", () => {
  test("line continuation is joined before bash -n", async () => {
    const code = "bun test tests/a.test.ts \\" + "\n" + "  tests/b.test.ts";
    const v = await validateBlockByLanguage({ file: "a.md", language: "bash", line: 1, code });
    expect(v.ok).toBe(true);
  });

  test("multi-line quoted string is joined", async () => {
    const code = [
      `bun -e "import { x } from ./a.ts;`,
      `  console.log(x ? 1 : 2);"`
    ].join("\n");
    const v = await validateBlockByLanguage({ file: "a.md", language: "bash", line: 1, code });
    expect(v.ok).toBe(true);
  });

  test("angle-bracket placeholder notation is skipped", async () => {
    const v = await validateBlockByLanguage({ file: "a.md", language: "bash", line: 1, code: "bun run x -- --id=<run-id>" });
    expect(v.ok).toBe(true);
  });

  test("comment-only block passes", async () => {
    const v = await validateBlockByLanguage({ file: "a.md", language: "sh", line: 1, code: "# just a comment" });
    expect(v.ok).toBe(true);
  });

  test("genuine bash syntax error is caught", async () => {
    const v = await validateBlockByLanguage({ file: "a.md", language: "bash", line: 1, code: "if then fi" });
    expect(v.ok).toBe(false);
  });
});
