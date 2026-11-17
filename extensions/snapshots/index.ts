// Snapshots the files in cwd after each turn; /tree offers to restore them.
//
// Accepted limitations:
// - Needs git >= 2.41.
// - Changes inside nested repos aren't restored.
// - Skips unreadable files.
// - Only the .gitignore files in cwd apply.
// - Restoring a point with other ignore rules deletes the files it ignored.
// - Keeps only the executable bit.
// - Ignores empty directories.
// - A restore failing after navigation only warns.
// - A restore that can't delete a file leaves it, silently.
// - Never prunes the snapshot repo.
// - Each session's first snapshot rehashes every file.
// - A killed process leaves its index behind.
// - Diffs over 1MB or 5s fail to show.
// - A tool result restores the files before its turn, unless it's the turn's
//   last.
// - A message restores the files right after it, dropping edits from later
//   visits, which only their snapshot entry restores.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Spacer, truncateToWidth } from "@earendil-works/pi-tui";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Repo } from "./repo.ts";
import { findTree, repeats, ENTRY_CUSTOM_TYPE } from "./snapshot.ts";

// Encodes cwd into a directory name, as pi does for session dirs:
// https://github.com/earendil-works/pi/blob/b4afdddf44e059c67ccf5097e5317d913521b470/packages/coding-agent/src/core/session-manager.ts#L593
function encodeCwd(cwd: string) {
  return `--${cwd.replace(/^[/\\]/, "").replaceAll(/[/\\:]/g, "-")}--`;
}

// Whether either dir contains the other. Resolves symlinks, so a link can't
// hide an overlap. The trailing separator stops /a/b matching /a/bc.
async function overlaps(a: string, b: string) {
  a = join(await realpath(a), sep);
  b = join(await realpath(b), sep);
  return a.startsWith(b) || b.startsWith(a);
}

function warn({ ui }: ExtensionContext, text: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  ui.notify(`snapshots: ${text}: ${message}`, "warning");
}

// The dialog title's horizontal padding.
const PADDING_COLUMNS = 2;

// Cuts a dialog title line to the terminal. Full off a TTY, like in RPC mode,
// where the client renders it.
function fitTitle(text: string) {
  if (!process.stdout.columns) return text;
  return truncateToWidth(text, process.stdout.columns - PADDING_COLUMNS);
}

// Pages input in less, resolving when it quits.
async function runLess(input: string) {
  // Overrides the user's -E and -F, which quit at once on a short diff, and
  // -X, which leaves it in the scrollback.
  const less = spawn("less", ["-R", "-+E", "-+F", "-+X"], {
    stdio: ["pipe", "inherit", "inherit"],
  });
  less.stdin.on("error", () => {
    // Ignores EPIPE, from quitting less before it reads all of input, the only
    // write error a pipe gives. A failed spawn rejects once() instead.
  });
  less.stdin.end(input);
  await once(less, "close");
  if (less.exitCode !== 0) {
    throw new Error(
      `less exited with ${String(less.exitCode ?? less.signalCode)}`,
    );
  }
}

// Shows a diff in less, suspending the TUI.
async function showDiff({ ui }: ExtensionContext, input: string) {
  await ui.custom<null>(async (tui, _theme, _keybindings, done) => {
    // Hands the screen to less as is, as fullscreen mode would otherwise print
    // itself to the scrollback.
    tui.stop({ preserveScreen: true });
    // Keeps Ctrl+C a key, as a SIGINT would also reach and kill pi.
    process.stdin.setRawMode(true);
    try {
      await runLess(input);
    } finally {
      tui.start();
      tui.requestRender(true);
    }
    done(null);
    return new Spacer(0);
  });
}

export default function snapshots(pi: ExtensionAPI) {
  // Set on session start, as cwd is fixed for this instance. Unset on the
  // first snapshot failure, so a broken or slow cwd costs at most one timeout.
  let repo: Repo | undefined;

  // Leaves repo unset on failure, or if cwd and the agent dir overlap, as
  // restoring would rewrite pi's own state. This also keeps the repo, which
  // is in the agent dir, out of cwd.
  pi.on("session_start", async (_event, ctx) => {
    const agentDir = getAgentDir();
    try {
      if (await overlaps(ctx.cwd, agentDir)) {
        throw new Error(`${ctx.cwd} overlaps the agent dir`);
      }
      const gitDir = join(agentDir, "snapshots", encodeCwd(ctx.cwd));
      repo = await Repo.open(ctx.cwd, gitDir);
    } catch (error) {
      warn(ctx, "disabled", error);
    }
  });

  // Saves the work tree as a snapshot, returning its tree hash.
  async function snapshot(ctx: ExtensionContext): Promise<string | undefined> {
    try {
      if (!repo) return undefined;
      const tree = await repo.save();
      // Skips repeating the snapshot at the leaf, as before_agent_start does
      // after turn_end.
      if (!repeats(ctx.sessionManager.getLeafEntry(), tree)) {
        pi.appendEntry(ENTRY_CUSTOM_TYPE, tree);
      }
      return tree;
    } catch (error) {
      warn(ctx, "snapshot failed, disabling", error);
      const failed = repo;
      repo = undefined;
      await failed?.close();
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
    if (!ctx.hasUI || !repo) return undefined;
    const current = await snapshot(ctx);
    if (current === undefined) return { cancel: true };
    const entries = ctx.sessionManager.getEntries();
    const branch = ctx.sessionManager.getBranch(preparation.targetId);
    const tree = findTree(entries, branch);
    if (tree === undefined || tree === current) return undefined;
    let stat;
    try {
      stat = fitTitle(await repo.diffStat(current, tree));
    } catch (error) {
      warn(ctx, "diff failed", error);
      return { cancel: true };
    }
    const title = `Restore files?\n\n${stat}`;
    const options = ["Restore", "Keep"];
    // custom() needs a terminal. First, so Enter on the reopened dialog shows
    // the diff again instead of restoring.
    if (ctx.mode === "tui") options.unshift("Diff");
    for (;;) {
      const choice = await ctx.ui.select(title, options);
      if (choice === undefined) {
        return { cancel: true };
      } else if (choice === "Restore") {
        pending = tree;
        return undefined;
      } else if (choice === "Keep") {
        return undefined;
      } else {
        try {
          await showDiff(ctx, await repo.diff(current, tree));
        } catch (error) {
          warn(ctx, "diff failed", error);
        }
      }
    }
  });

  // Restores after navigation, so an aborted branch summary leaves the files
  // alone. Warns after pi redraws the chat, which would clear the warning.
  pi.on("session_tree", async (_event, ctx) => {
    if (pending === undefined || !repo) return;
    try {
      await repo.restore(pending);
    } catch (error) {
      setTimeout(() => {
        warn(ctx, "restore failed", error);
      });
    }
  });

  // Catches changes since the last snapshot, like from a ! command.
  pi.on("session_shutdown", async (_event, ctx) => {
    await snapshot(ctx);
    await repo?.close();
  });
}
