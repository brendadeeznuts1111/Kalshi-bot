// @see https://bun.com/docs/runtime/shell#redirection
// @see https://bun.com/docs/test/index#run-tests
// Pins the Bun Shell idioms this repo depends on (verified on Bun 1.4.0) so a
// Bun upgrade that regresses them fails here instead of in a live flow.
import { afterAll, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { $ } from "bun";

const scratch = `${tmpdir()}/shell-idioms-${randomUUID()}`;

afterAll(async () => {
  await $`rm -rf ${scratch}`.nothrow().quiet();
});

describe("capture + exit code", () => {
  test(".nothrow().quiet() returns exitCode with Buffer stdout/stderr", async () => {
    const { exitCode, stdout, stderr } = await $`printf "out\n"`.nothrow().quiet();
    expect(exitCode).toBe(0);
    expect(stdout).toBeInstanceOf(Buffer);
    expect(stdout.toString()).toBe("out\n");
    expect(stderr.toString()).toBe("");
  });

  test(".nothrow() reports non-zero exit without throwing", async () => {
    const { exitCode } = await $`sh -c "exit 3"`.nothrow().quiet();
    expect(exitCode).toBe(3);
  });

  test(".text() throws on non-zero with exitCode on the error", async () => {
    let threw = false;
    try {
      await $`sh -c "exit 3"`.text();
    } catch (err) {
      threw = true;
      expect((err as { exitCode: number }).exitCode).toBe(3);
    }
    expect(threw).toBe(true);
  });
});

describe("stdin redirection from JS objects", () => {
  test("< ${Buffer.from()} feeds stdin", async () => {
    const { stdout } = await $`cat < ${Buffer.from("via-buffer\n")}`.nothrow().quiet();
    expect(stdout.toString()).toBe("via-buffer\n");
  });

  test("< ${Buffer.alloc(0)} closes stdin immediately", async () => {
    const { exitCode, stdout } = await $`cat < ${Buffer.alloc(0)}`.nothrow().quiet();
    expect(exitCode).toBe(0);
    expect(stdout.toString()).toBe("");
  });

  test("< ${new Response()} feeds stdin from a body", async () => {
    const { stdout } = await $`cat < ${new Response("via-response")}`.nothrow().quiet();
    expect(stdout.toString()).toBe("via-response");
  });
});

describe("stdout redirection to JS objects", () => {
  test("> ${Bun.file(path)} writes the file", async () => {
    const target = `${scratch}/out.txt`;
    await $`mkdir -p ${scratch}`.nothrow().quiet();
    await $`echo file-out > ${Bun.file(target)}`.nothrow();
    expect(await Bun.file(target).text()).toBe("file-out\n");
  });

  test("> ${Buffer} writes into the existing buffer", async () => {
    const buf = Buffer.alloc(16);
    await $`printf "hi" > ${buf}`.nothrow();
    expect(buf.subarray(0, 2).toString()).toBe("hi");
  });
});

describe("line streaming", () => {
  test(".lines() yields a trailing empty entry when output ends in a newline", async () => {
    const lines: string[] = [];
    for await (const line of $`printf "a\nb\nc\n"`.lines()) lines.push(line);
    expect(lines).toEqual(["a", "b", "c", ""]);
  });

  test(".lines() on non-terminated output has no trailing empty", async () => {
    const lines: string[] = [];
    for await (const line of $`printf "a\nb\nc"`.lines()) lines.push(line);
    expect(lines).toEqual(["a", "b", "c"]);
  });
});


describe("result shapes", () => {
  test("$ result exposes exactly stdout/stderr/exitCode (Buffers + number)", async () => {
    const result = await $`printf "x"`.nothrow().quiet();
    expect(Object.keys(result).sort()).toEqual(["exitCode", "stderr", "stdout"]);
    expect(typeof result.exitCode).toBe("number");
    expect(result.stdout).toBeInstanceOf(Buffer);
    expect(result.stderr).toBeInstanceOf(Buffer);
  });

  test("$(...) substitution inlines another command output", async () => {
    const { stdout } = await $`printf "outer $(printf inner)"`.nothrow().quiet();
    expect(stdout.toString()).toBe("outer inner");
  });

  test("streaming (no .quiet()) still captures Buffers while printing live", async () => {
    const { stdout } = await $`printf "stream-captured\n"`.nothrow();
    expect(stdout.toString()).toBe("stream-captured\n");
  });
});
describe("utilities", () => {
  test("$.escape produces a shell-safe fragment", () => {
    expect($.escape("a$(b)c")).toContain("\\$(b)c");
  });

  test("$.braces expands brace patterns", () => {
    expect($.braces("echo {1,2,3}")).toEqual(["echo 1", "echo 2", "echo 3"]);
  });
});
