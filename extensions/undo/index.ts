// Snapshots files after each turn; /tree offers to restore them.
//
// Accepted limitations:
// - Needs git >= 2.41.
// - Changes inside nested repos aren't undone.
// - Skips unreadable files.
// - Only the .gitignore files in cwd apply.
// - Restoring a point with other ignore rules deletes the files it ignored.
// - Keeps only the executable bit.
// - A restore failing after navigation only warns.
// - A restore that can't delete a file leaves it, silently.
// - Never prunes the undo repo.
// - Each session's first snapshot rehashes every file.
// - A killed process leaves its index behind.

import { execFile } from "node:child_process";
import { access, mkdir, realpath, rm } from "node:fs/promises";
import { join, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  CustomEntry,
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

// Encodes cwd into a directory name, as pi does for session dirs:
// https://github.com/earendil-works/pi/blob/b4afdddf44e059c67ccf5097e5317d913521b470/packages/coding-agent/src/core/session-manager.ts#L593
function encodeCwd(cwd: string) {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

// Whether either dir contains the other. The trailing separator stops /a/b
// matching /a/bc.
function overlaps(a: string, b: string) {
  a = join(a, sep);
  b = join(b, sep);
  return a.startsWith(b) || b.startsWith(a);
}

// A snapshot of the files at message `at`, the last one before it.
function isSnapshot(
  entry: SessionEntry,
): entry is CustomEntry<{ tree: string; at?: string }> {
  return entry.type === "custom" && entry.customType === "undo";
}

function lastMessageId(entries: SessionEntry[]) {
  return entries.findLast(({ type }) => type === "message")?.id;
}

// Whether /tree opens `entry` in the editor, moving the leaf to its parent, as
// pi does:
// https://github.com/earendil-works/pi/blob/b4afdddf44e059c67ccf5097e5317d913521b470/packages/coding-agent/src/core/agent-session.ts#L4255
function opensInEditor(entry: SessionEntry | undefined) {
  const user = entry?.type === "message" && entry.message.role === "user";
  const custom = entry?.type === "custom_message";
  return user || custom;
}

// Finds the latest snapshot at message `at`.
function findSnapshotAt(entries: SessionEntry[], at: string | undefined) {
  if (!at) return;
  return entries.filter(isSnapshot).findLast(({ data }) => data?.at === at);
}

// Finds the latest snapshot at the /tree target, falling back to the last one
// before it.
function findSnapshot({ sessionManager }: ExtensionContext, targetId: string) {
  const branch = sessionManager.getBranch(targetId);
  if (opensInEditor(branch.at(-1))) branch.pop();
  const last = branch.findLast(isSnapshot);
  // A selected snapshot is the exact state there.
  if (last === branch.at(-1)) return last;
  const at = lastMessageId(branch);
  return findSnapshotAt(sessionManager.getEntries(), at) ?? last;
}

function warn({ ui }: ExtensionContext, text: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  ui.notify(`undo: ${text}: ${message}`, "warning");
}

// A git command that exited non-zero.
class GitError extends Error {
  readonly code: number | undefined;

  constructor(command: string, code: number | undefined, stderr: string) {
    super(`${command} exited ${String(code)}: ${stderr.trim()}`);
    this.code = code;
  }
}

const undoDir = join(getAgentDir(), "undo");

function gitDir(cwd: string) {
  return join(undoDir, encodeCwd(cwd));
}

// A per-process index, so concurrent sessions don't collide on its lock.
function indexFile(cwd: string) {
  return join(gitDir(cwd), `index-${process.pid}`);
}

// Runs git against a private repo, leaving the project's own git state
// untouched. Rejects with a short message on failure or timeout.
function git(cwd: string, ...args: string[]) {
  const command = `git ${args.join(" ")}`;
  // Passes only PATH, and hides global and system config and the project's
  // attributes, so files are stored byte for byte.
  const env = {
    PATH: process.env["PATH"],
    GIT_DIR: gitDir(cwd),
    GIT_WORK_TREE: cwd,
    GIT_INDEX_FILE: indexFile(cwd),
    GIT_CONFIG_NOSYSTEM: "1",
    // Git's built-in empty tree, which needs no object in the repo.
    GIT_ATTR_SOURCE: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
  };
  return new Promise<string>((resolve, reject) => {
    const options = { cwd, env, timeout: 5000 };
    execFile("git", args, options, (error, stdout, stderr) => {
      if (!error) {
        resolve(stdout.trim());
      } else if (error.killed) {
        reject(new Error(`${command} timed out`));
      } else if (typeof error.code === "string") {
        // Never ran, like when git or cwd is missing.
        reject(new Error(`${command} failed: ${error.message}`));
      } else {
        reject(new GitError(command, error.code, stderr));
      }
    });
  });
}

// Creates the private repo if missing. Re-running init would rewrite the
// config, racing other processes on its lock.
async function init(cwd: string) {
  try {
    await access(join(gitDir(cwd), "HEAD"));
  } catch {
    await git(cwd, "init", "--quiet");
  }
}

// Stages the work tree, skipping files git can't add, like nested repos
// without commits. Git exits 1 if it skipped any.
async function addAll(cwd: string) {
  try {
    await git(cwd, "add", "--all", "--ignore-errors");
  } catch (error) {
    if (!(error instanceof GitError && error.code === 1)) throw error;
  }
}

// Writes the work tree to the private repo, returning its tree hash. Refuses
// if cwd and the agent dir overlap, as snapshotting would add the undo repo to
// itself and restoring would rewrite pi's own state. Every restore follows a
// snapshot, so this guards those too.
async function writeTree(cwd: string) {
  // Resolves symlinks, as the agent dir is often linked from a dotfiles repo.
  if (overlaps(await realpath(cwd), await realpath(getAgentDir()))) {
    throw new Error(`${cwd} overlaps the agent dir`);
  }
  await mkdir(undoDir, { recursive: true });
  await init(cwd);
  await addAll(cwd);
  return git(cwd, "write-tree");
}

function undo(pi: ExtensionAPI) {
  // Set on the first snapshot failure, so a broken or slow cwd costs at most
  // one timeout.
  let disabled = false;

  // Saves the work tree as a snapshot, returning its tree hash.
  async function snapshot(ctx: ExtensionContext): Promise<string | undefined> {
    try {
      if (disabled) return;
      const tree = await writeTree(ctx.cwd);
      const branch = ctx.sessionManager.getBranch();
      const last = branch.at(-1);
      // Skips repeating the leaf, as before_agent_start does after turn_end.
      if (last && isSnapshot(last) && last.data?.tree === tree) return tree;
      pi.appendEntry("undo", { tree, at: lastMessageId(branch) });
      return tree;
    } catch (error) {
      disabled = true;
      warn(ctx, "snapshot failed, disabling", error);
      return undefined;
    }
  }

  pi.on("before_agent_start", async (_event, ctx) => {
    await snapshot(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    await snapshot(ctx);
  });

  // The tree to restore once /tree navigation commits.
  let pending: string | undefined;

  // Before /tree navigation, snapshots the old branch, then offers to restore
  // the files to how they were the last time at the target, if they differ.
  // Cancels navigation on failure, as navigating clears the warning.
  pi.on("session_before_tree", async ({ preparation }, ctx) => {
    pending = undefined;
    if (!ctx.hasUI || disabled) return;
    const current = await snapshot(ctx);
    if (!current) return { cancel: true };
    const tree = findSnapshot(ctx, preparation.targetId)?.data?.tree;
    if (!tree || tree === current) return;
    const choice = await ctx.ui.select("Restore files?", ["Restore", "Keep"]);
    if (choice === undefined) return { cancel: true };
    if (choice !== "Restore") return;
    try {
      // Checks the tree exists, while navigation can still be cancelled.
      await git(ctx.cwd, "ls-tree", tree);
      pending = tree;
      return;
    } catch (error) {
      warn(ctx, "restore failed", error);
      return { cancel: true };
    }
  });

  // Restores after navigation, so an aborted branch summary leaves the files
  // alone. Warns after pi redraws the chat, which would clear the warning.
  pi.on("session_tree", async (_event, ctx) => {
    if (!pending) return;
    try {
      await git(ctx.cwd, "read-tree", "-u", "--reset", pending);
    } catch (error) {
      setTimeout(() => {
        warn(ctx, "restore failed", error);
      });
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    await rm(indexFile(ctx.cwd), { force: true });
  });
}

export default undo satisfies ExtensionFactory;
