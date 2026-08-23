// @see https://bun.com/docs/runtime/utils#bun-openineditor
// @see https://bun.com/docs/runtime/utils#bun-which
/**
 * Editor resolution for Bun.openInEditor.
 *
 * Precedence: PATTERN_EDITOR=vscode|subl env -> Bun.which auto-detect
 * (code -> vscode, subl -> subl) -> system default (no editor option).
 *
 * Bun.openInEditor accepts only "vscode" | "subl"; anything else falls back
 * to the OS default editor for the file type.
 */

export type EditorName = "vscode" | "subl";

export type EditorEnv = Record<string, string | undefined>;

/**
 * Resolve the editor name to pass to Bun.openInEditor.
 * Pure (injectable which/env) for tests.
 */
export function resolveEditorName(
  env: EditorEnv = Bun.env as EditorEnv,
  which: (bin: string) => string | null = (bin) => Bun.which(bin),
): EditorName | undefined {
  const e = (env.PATTERN_EDITOR ?? "").trim().toLowerCase();
  if (e === "vscode" || e === "subl") return e;
  if (which("code")) return "vscode";
  if (which("subl")) return "subl";
  return undefined;
}

export type OpenTarget = {
  path: string;
  line?: number;
  column?: number;
};

export type OpenTargetDeps = {
  env?: EditorEnv;
  which?: (bin: string) => string | null;
  log?: (msg: string) => void;
};

/**
 * Open a target in the resolved editor (or the system default).
 * Logs the choice to stderr when PATTERN_EDITOR_DEBUG=1.
 */
export function openTarget(target: OpenTarget, deps: OpenTargetDeps = {}): void {
  const env = deps.env ?? (Bun.env as EditorEnv);
  const editor = resolveEditorName(env, deps.which ?? ((bin) => Bun.which(bin)));
  const options: { editor?: EditorName; line?: number; column?: number } = {};
  if (editor) options.editor = editor;
  if (target.line !== undefined) options.line = target.line;
  if (target.column !== undefined) options.column = target.column;
  Bun.openInEditor(target.path, options);

  const log = deps.log ?? ((msg: string): void => {
    if (env.PATTERN_EDITOR_DEBUG === "1") process.stderr.write(msg + "\n");
  });
  const where = target.line !== undefined ? ":" + target.line : "";
  log("openInEditor: " + target.path + where + (editor ? " via " + editor : " (system editor)"));
}
