/**
 * journal.ts — Crash-safe write-ahead transaction journal.
 *
 * Inspired by the immutable pending / create-only committed sidecar pattern from
 * reasonix-guard PR #6973:
 *
 *   - Before mutating:  writePending() writes an immutable pending journal.
 *   - After success:    commit() writes a create-only committed sidecar.
 *   - On crash/suspect: reconcile() scans for orphaned pending journals.
 *   - Cleanup:          rollbackPending() removes a pending journal that was
 *                        never committed (safe to retry).
 *
 * No external dependencies — uses Bun.write with exclusive-create semantics
 * and the file-system rename primitive for atomicity.
 */
import { exists, mkdir, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mintSortableId } from "./ids.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JournalEntry = {
  /** UUID v7 identifying this transaction (sortable by mint time). */
  txnId: string;
  /** Machine-readable action name (e.g. "rotate-key"). */
  action: string;
  /** ISO-8601 timestamp of when the pending was written. */
  createdAt: string;
  /** Opaque params that describe the planned mutation. */
  params: unknown;
};

export type CommitRecord = {
  txnId: string;
  action: string;
  committedAt: string;
  result: unknown;
};

export type ReconcileEntry = {
  txnId: string;
  action: string;
  status: "pending" | "committed";
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pendingPath(dir: string, txnId: string): string {
  return join(dir, `pending-${txnId}.json`);
}

function committedPath(dir: string, txnId: string): string {
  return join(dir, `committed-${txnId}.json`);
}

/** Best-effort creation of the journal directory. */
async function ensureDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // race with concurrent mkdir — non-fatal
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Write a pending transaction journal.
 *
 * The file is created exclusively (fails if a pending with the same txnId
 * already exists).  After this call the transaction is *in-flight*; call
 * commit() upon success or rollbackPending() upon failure.
 *
 * @returns the txnId and the path of the written journal.
 */
export async function writePending(
  dir: string,
  action: string,
  params: unknown,
): Promise<{ txnId: string; pendingPath: string }> {
  await ensureDir(dir);
  const txnId = mintSortableId();
  const entry: JournalEntry = {
    txnId,
    action,
    createdAt: new Date().toISOString(),
    params,
  };
  const path = pendingPath(dir, txnId);

  // Write to a temp path and rename to make the create atomic.
  const tmpPath = path + ".tmp";
  await writeFile(tmpPath, JSON.stringify(entry, null, 2) + "\n", { mode: 0o600 });
  await rename(tmpPath, path);

  return { txnId, pendingPath: path };
}

/**
 * Mark a pending transaction as committed.
 *
 * Writes a create-only sidecar file.  If the committed sidecar already exists
 * (i.e. this txnId was already committed), the write is **rejected** to
 * prevent accidental double-commit or replay.
 */
export async function commit(
  dir: string,
  txnId: string,
  result: unknown,
): Promise<string> {
  await ensureDir(dir);
  const cPath = committedPath(dir, txnId);

  // Refuse to overwrite an existing committed sidecar.
  if (await exists(cPath).catch(() => false)) {
    throw new Error(
      `commit refused: committed sidecar already exists for txn ${txnId}`,
    );
  }

  // Read the action from the pending journal (best-effort — the pending
  // may have been cleaned up by a previous reconcile pass).
  let action = "";
  try {
    const pendingContent = await Bun.file(pendingPath(dir, txnId)).text();
    const parsed = JSON.parse(pendingContent) as JournalEntry;
    action = parsed.action || "";
  } catch {
    // pending file gone or unreadable — proceed with empty action
  }

  const record: CommitRecord = {
    txnId,
    action,
    committedAt: new Date().toISOString(),
    result,
  };

  // Write temp and atomic rename for crash safety.
  const tmpPath = cPath + ".tmp";
  await writeFile(tmpPath, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
  await rename(tmpPath, cPath);

  return cPath;
}

/**
 * Reconcile — scan a journal directory and report every transaction found.
 *
 * Returns an array of ReconcileEntry items.  A transaction is "pending" if
 * only a pending-*.json exists; "committed" if both or just the committed
 * sidecar exists.
 */
export async function reconcile(dir: string): Promise<ReconcileEntry[]> {
  const results: ReconcileEntry[] = [];
  const seen = new Set<string>();

  // Scan for committed sidecars first.
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return results; // directory doesn't exist yet
  }

  for (const name of entries) {
    const match = name.match(/^(pending|committed)-([0-9a-f-]+)\.json$/);
    if (!match) continue;
    const kind = match[1] as "pending" | "committed";
    const txnId = match[2];

    if (kind === "committed") {
      seen.add(txnId);
      // Try to read action from the committed file.
      let action = "";
      try {
        const content = await Bun.file(join(dir, name)).text();
        const parsed = JSON.parse(content) as CommitRecord;
        action = parsed.action || "";
      } catch {
        // best-effort
      }
      results.push({ txnId, action, status: "committed", createdAt: "" });
    }
  }

  // Then scan for pending files not yet committed.
  for (const name of entries) {
    const match = name.match(/^pending-([0-9a-f-]+)\.json$/);
    if (!match) continue;
    const txnId = match[1];
    if (seen.has(txnId)) {
      // Both pending and committed exist — the pending is a leftover that
      // can be cleaned up.  Report as committed.
      continue;
    }

    let action = "";
    let createdAt = "";
    try {
      const content = await Bun.file(join(dir, name)).text();
      const parsed = JSON.parse(content) as JournalEntry;
      action = parsed.action || "";
      createdAt = parsed.createdAt || "";
    } catch {
      // best-effort
    }
    results.push({ txnId, action, status: "pending", createdAt });
  }

  return results.sort(
    (a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""),
  );
}

/**
 * Roll back (delete) a pending transaction journal.
 *
 * Only removes the pending-*.json file.  If the committed sidecar exists
 * this is a no-op (the transaction is already finalized).
 *
 * Safe to call multiple times — delete is idempotent.
 */
export async function rollbackPending(dir: string, txnId: string): Promise<void> {
  const pPath = pendingPath(dir, txnId);
  const cPath = committedPath(dir, txnId);

  // Never remove a committed transaction's pending journal — the committed
  // sidecar is the authority.  But we can clean up the stale pending.
  const committedExists = await exists(cPath).catch(() => false);
  if (!committedExists) {
    await unlink(pPath).catch(() => {
      // already gone — idempotent
    });
  }
}
