// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { scanDeadImports } from "../../src/lib/design-deadcode.ts";
import { npmModulesInBundle } from "../../src/lib/design-budget.ts";

const fixture = "/tmp/deadcode-test-fixture.ts";

describe("scanDeadImports (heuristic)", () => {
  test("flags unused named imports but not used/aliased ones", async () => {
    const dead = await scanDeadImports([fixture]);
    expect(dead).toHaveLength(1);
    expect(dead[0]!.name).toBe("unused");
    expect(dead[0]!.specifier).toBe("./x.ts");
  });

  test("tolerates missing files", async () => {
    expect(await scanDeadImports(["/tmp/nope-" + Math.random().toString(36) + ".ts"])).toEqual([]);
  });

  test("type-only imports are not reported as dead (types stay in body)", async () => {
    const f = "/tmp/deadcode-type-fixture.ts";
    await Bun.write(
      f,
      'import { type T, used } from "./x.ts";\nexport const v: T = used(1);\n',
    );
    const dead = await scanDeadImports([f]);
    expect(dead.map((d) => d.name)).toEqual([]);
  });
});

describe("npmModulesInBundle (zero-dep contract)", () => {
  test("finds node_modules inputs, ignores source paths", () => {
    expect(
      npmModulesInBundle({
        inputs: {
          "src/a.ts": { bytes: 1, imports: [] },
          "node_modules/marked/index.js": { bytes: 1, imports: [] },
        },
        outputs: {},
      }),
    ).toEqual(["node_modules/marked/index.js"]);
    expect(npmModulesInBundle({ inputs: { "src/a.ts": {} }, outputs: {} })).toEqual([]);
    expect(npmModulesInBundle(null)).toEqual([]);
  });
});
