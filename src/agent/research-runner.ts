// @see https://bun.com/docs/runtime/child-process#inter-process-communication-ipc
// @see https://bun.com/docs/runtime/child-process#reference
import { loadRunFromDb } from "../research/cache.ts";
import type { CliOptions } from "../research/cli.ts";
import {
  buildResearchSpawnArgs,
  formatProgressLine,
  isResearchProgressMessage,
  type ResearchProgressSink,
} from "../research/research-progress.ts";
import { ROOT, joinPath } from "../research/paths.ts";
import type { ResearchRun } from "../research/types.ts";

export type SpawnResearchResult =
  | { ok: true; run: ResearchRun; exitCode: 0 }
  | { ok: false; exitCode: number; message: string };

export type SpawnResearchOptions = CliOptions & {
  /** Optional in-process progress sink. */
  onProgress?: ResearchProgressSink;
};

/** Spawn research as IPC child — structured progress on IPC, stderr inherited for remediation text. */
export async function spawnResearch(opts: SpawnResearchOptions): Promise<SpawnResearchResult> {
  const { onProgress, ...cliOpts } = opts;
  const script = joinPath(ROOT, "src/research/cli.ts");
  const args = buildResearchSpawnArgs(cliOpts);

  return new Promise((resolve) => {
    let completeRunId: string | undefined;
    let lastError: string | undefined;
    let lastExitCode: number | undefined;

    const proc = Bun.spawn({
      cmd: ["bun", script, ...args],
      cwd: ROOT,
      env: { ...process.env },
      stdin: "inherit",
      stdout: "pipe",
      stderr: "inherit",
      serialization: "advanced",
      ipc(message: unknown) {
        if (!isResearchProgressMessage(message)) return;
        onProgress?.(message);
        if (message.type === "complete") completeRunId = message.runId;
        if (message.type === "error") {
          lastError = message.message;
          lastExitCode = message.exitCode;
        }
        const line = formatProgressLine(message);
        if (line) console.error(line);
      },
    });

    void (async () => {
      try {
        const exitCode = await proc.exited;
        const stdout = proc.stdout ? await new Response(proc.stdout).text() : "";

        if (exitCode !== 0) {
          resolve({
            ok: false,
            exitCode: lastExitCode ?? exitCode,
            message:
              lastError ??
              (completeRunId
                ? `Research exited ${exitCode} after run ${completeRunId}`
                : `Research exited ${exitCode}`),
          });
          return;
        }

        const runId = completeRunId ?? stdout.match(/Run complete: (\S+)/)?.[1];
        const run = runId ? loadRunFromDb(runId) : null;
        if (!run) {
          resolve({
            ok: false,
            exitCode: 1,
            message: "Research completed but run not found in cache",
          });
          return;
        }
        resolve({ ok: true, run, exitCode: 0 });
      } catch (err) {
        resolve({
          ok: false,
          exitCode: 1,
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        proc.disconnect();
      }
    })();
  });
}
