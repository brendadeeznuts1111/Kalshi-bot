// @see https://bun.com/docs/runtime/utils#bun-openineditor
// @see https://bun.com/docs/runtime/utils#bun-which
// @see https://bun.com/docs/runtime/child-process#spawn-a-process-bun-spawn
/**
 * Editor launcher: resolve an editor CLI (PATTERN_EDITOR env or Bun.which
 * auto-detect across vscode-family + subl), launch it directly via
 * Bun.spawn with line/column args, and fall back to Bun.openInEditor for the
 * system default when no known editor CLI is found.
 *
 * Targets accept "path", "path:line", "path:line:column", or ripgrep-style
 * "path:line:column: rest" (parseOpenTarget).
 */

export type EditorFamily = "vscode" | "subl" | "unknown";

export type ResolvedEditor = {
  /** CLI name (e.g. code, cursor, subl) or the PATTERN_EDITOR value. */
  name: string;
  family: EditorFamily;
  /** Absolute binary path from Bun.which. */
  binary: string;
};

export type EditorEnv = Record<string, string | undefined>;

type WhichFn = (bin: string) => string | null;

/** Known CLIs, in auto-detect order (vscode-family before subl). */
const EDITOR_CLIS: ReadonlyArray<{ bin: string; family: EditorFamily }> = [
  { bin: "code", family: "vscode" },
  { bin: "cursor", family: "vscode" },
  { bin: "windsurf", family: "vscode" },
  { bin: "codium", family: "vscode" },
  { bin: "subl", family: "subl" },
] as const;

/**
 * Resolve the editor to launch. PATTERN_EDITOR names a CLI (known or custom);
 * otherwise auto-detect. Returns null when nothing is on PATH.
 * Pure (injectable env/which) for tests.
 */
export function resolveEditor(
  env: EditorEnv = Bun.env as EditorEnv,
  which: WhichFn = (bin) => Bun.which(bin),
): ResolvedEditor | null {
  const e = (env.PATTERN_EDITOR ?? "").trim().toLowerCase();
  if (e) {
    if (e === "vscode" || e === "subl") {
      // Friendly name → try that family\'s CLIs in order (vscode → code/cursor/…).
      for (const c of EDITOR_CLIS) {
        if (c.family !== e) continue;
        const binary = which(c.bin);
        if (binary) return { name: c.bin, family: c.family, binary };
      }
      return null;
    }
    // Direct CLI name (code, cursor, subl, or any custom binary).
    const known = EDITOR_CLIS.find((c) => c.bin === e);
    const binary = which(e);
    if (binary) return { name: e, family: known?.family ?? "unknown", binary };
    return null;
  }
  for (const c of EDITOR_CLIS) {
    const binary = which(c.bin);
    if (binary) return { name: c.bin, family: c.family, binary };
  }
  return null;
}

export type OpenTarget = {
  path: string;
  line?: number | undefined;
  column?: number | undefined;
};

/**
 * Parse "path", "path:line", "path:line:column", or ripgrep-style
 * "path:line:column: rest" into an OpenTarget. Tolerates drive letters.
 */
export function parseOpenTarget(spec: string): OpenTarget {
  const s = spec.trim();
  const m = /^(.+?):(\d+)(?::(\d+))?(?::.*)?$/.exec(s);
  if (m) {
    return {
      path: m[1]!,
      line: Number(m[2]),
      column: m[3] ? Number(m[3]) : undefined,
    };
  }
  return { path: s };
}

function vscodeArgs(target: OpenTarget): string[] {
  const where = target.path +
    (target.line !== undefined ? ":" + target.line + (target.column !== undefined ? ":" + target.column : "") : "");
  return ["-g", where];
}

function editorArgs(editor: ResolvedEditor, target: OpenTarget): string[] {
  if (editor.family === "vscode") return vscodeArgs(target);
  if (editor.family === "subl") {
    return [target.path + (target.line !== undefined ? ":" + target.line : "")];
  }
  return [target.path];
}

export type OpenTargetDeps = {
  env?: EditorEnv;
  which?: WhichFn;
  spawn?: (bin: string, args: string[]) => void;
  log?: (msg: string) => void;
};

/**
 * Open a target: spawn the resolved editor CLI with line/column args, or
 * fall back to Bun.openInEditor (system default). Logs with PATTERN_EDITOR_DEBUG.
 */
export function openTarget(target: OpenTarget, deps: OpenTargetDeps = {}): void {
  const env = deps.env ?? (Bun.env as EditorEnv);
  const which = deps.which ?? ((bin: string) => Bun.which(bin));
  const spawn = deps.spawn ?? ((bin: string, args: string[]) => {
    // Detach: the editor is a long-lived GUI process — without unref() the
    // parent (e.g. the editor:open CLI) would hang until the editor exits
    // (Bun: 'the parent process does not terminate until all children have
    // exited').
    Bun.spawn([bin, ...args]).unref();
  });
  const log = deps.log ?? ((msg: string): void => {
    if (env.PATTERN_EDITOR_DEBUG === "1") process.stderr.write(msg + "\n");
  });

  const editor = resolveEditor(env, which);
  if (editor) {
    spawn(editor.binary, editorArgs(editor, target));
    const where = target.line !== undefined ? ":" + target.line : "";
    log("open: " + target.path + where + " via " + editor.name);
    return;
  }

  try {
    Bun.openInEditor(target.path, {
      ...(target.line !== undefined ? { line: target.line } : {}),
      ...(target.column !== undefined ? { column: target.column } : {}),
    });
  } catch (err) {
    // Bun 1.4 behavior change: openInEditor() THROWS when no editor can be
    // found (before, it returned silently). Preserve the old contract -
    // log and return, don't crash the CLI on editor-less hosts.
    log("openInEditor failed: " + (err as Error).message);
    return;
  }
  log("open: " + target.path + " (system editor)");
}
