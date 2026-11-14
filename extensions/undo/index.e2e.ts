import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import type { TestContext } from "node:test";
import type { TuiTest } from "@microsoft/tui-test";
import { startPi } from "#e2e/pi.ts";

const execFileAsync = promisify(execFile);

function git(cwd: string, ...args: string[]) {
  return execFileAsync("git", args, { cwd });
}

// Each file in cwd with its contents.
async function readFiles(cwd: string) {
  const names = await readdir(cwd);
  return Object.fromEntries(
    await Promise.all(
      names.map(
        async (name) =>
          [name, await readFile(join(cwd, name), "utf8")] as const,
      ),
    ),
  );
}

// A project with a.txt and b.txt.
async function createProject(t: TestContext) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-e2e-project-"));
  t.after(() => rm(cwd, { recursive: true }));
  await writeFile(join(cwd, "a.txt"), "a");
  await writeFile(join(cwd, "b.txt"), "b");
  return cwd;
}

// pi with undo and its fixture in cwd, home if unset, with env added to its
// environment.
function startUndo(t: TestContext, cwd?: string, env?: Record<string, string>) {
  return startPi(t, {
    extension: "undo",
    cwd,
    args: ["-e", join(import.meta.dirname, "index.fixture.ts")],
    env,
  });
}

// Changes files in a turn.
async function changeFiles(terminal: TuiTest) {
  await terminal.submit("edit a, delete b, create c");
  await terminal.getByText("done").expect();
}

// Navigates /tree to the first entry matching search, without a summary.
async function navigate(terminal: TuiTest, search: string) {
  await terminal.submit("/tree");
  await terminal.type(search);
  await terminal.press("Enter");
  await terminal.getByText("Summarize branch?").expect();
  await terminal.press("Enter"); // No summary.
}

// Changes files in a turn, then opens the restore dialog for its prompt, with
// env added to pi's environment.
async function openRestoreDialog(t: TestContext, env?: Record<string, string>) {
  const cwd = await createProject(t);
  const terminal = await startUndo(t, cwd, env);
  await changeFiles(terminal);
  await navigate(terminal, "edit a");
  await terminal.getByText("Restore files?").expect();
  return { cwd, terminal };
}

void test("restore on /tree reverts edits, deletions and new files", async (t) => {
  const { cwd, terminal } = await openRestoreDialog(t);
  await terminal.press("Down");
  await terminal.press("Enter"); // Restore.
  await terminal.getByText("Navigated to selected point").expect();
  assert.deepEqual(await readFiles(cwd), { "a.txt": "a", "b.txt": "b" });
});

void test("keep on /tree navigates without touching files", async (t) => {
  const { cwd, terminal } = await openRestoreDialog(t);
  await terminal.press("Down");
  await terminal.press("Down");
  await terminal.press("Enter"); // Keep.
  await terminal.getByText("Navigated to selected point").expect();
  assert.deepEqual(await readFiles(cwd), { "a.txt": "A", "c.txt": "c" });
});

void test("dismissing the dialog cancels navigation", async (t) => {
  const { cwd, terminal } = await openRestoreDialog(t);
  await terminal.press("Escape");
  await terminal.getByText("Navigation cancelled").expect();
  assert.deepEqual(await readFiles(cwd), { "a.txt": "A", "c.txt": "c" });
});

void test("diff shows the changes, then returns to the dialog at it", async (t) => {
  const { terminal } = await openRestoreDialog(t);
  await terminal.press("Enter"); // Diff.
  await terminal.getByText("diff --git a/a.txt b/a.txt").expect();
  await terminal.press("q");
  await terminal.getByText("→ Diff").expect();
});

void test("ctrl+c in diff leaves pi running", async (t) => {
  const { terminal } = await openRestoreDialog(t);
  await terminal.press("Enter"); // Diff.
  await terminal.getByText("diff --git a/a.txt b/a.txt").expect();
  await terminal.press("Ctrl+C");
  await terminal.press("q");
  // A dead pi leaves its last frame, so checks it still takes keys.
  await terminal.press("Down");
  await terminal.getByText("→ Restore").expect();
});

void test("diff overrides the user's less options that break it", async (t) => {
  // -F would quit less at once, never showing its prompt.
  const { terminal } = await openRestoreDialog(t, { LESS: "-FRX" });
  await terminal.press("Enter"); // Diff.
  await terminal.getByText("(END)").expect();
});

void test("diff leaves no copy of pi in the scrollback", async (t) => {
  // Outside cwd, as files there would show in the diff.
  const logDir = await mkdtemp(join(tmpdir(), "pi-e2e-log-"));
  t.after(() => rm(logDir, { recursive: true }));
  const log = join(logDir, "tui.log");
  const { terminal } = await openRestoreDialog(t, { PI_TUI_WRITE_LOG: log });
  await terminal.press("Enter"); // Diff.
  await terminal.getByText("diff --git a/a.txt b/a.txt").expect();
  // What pi wrote since leaving its alternate screen for less.
  const output = await readFile(log, "utf8");
  const mainScreen = output.slice(output.lastIndexOf("\x1b[?1049l"));
  assert.doesNotMatch(mainScreen, /faux-1/); // The footer.
});

void test("the diffstat is cut to the terminal width", async (t) => {
  const terminal = await startUndo(t, await createProject(t));
  await terminal.resize(40, 30);
  await changeFiles(terminal);
  await navigate(terminal, "edit a");
  await terminal.getByText("3 files changed, 2 insertions(+), 2...").expect();
  await terminal.getByText("deletions(-)").expect({ not: true });
});

void test("no dialog when files match the target", async (t) => {
  const cwd = await createProject(t);
  const terminal = await startUndo(t, cwd);
  await changeFiles(terminal);
  await writeFile(join(cwd, "a.txt"), "a");
  await writeFile(join(cwd, "b.txt"), "b");
  await rm(join(cwd, "c.txt"));
  await navigate(terminal, "edit a");
  await terminal.getByText("Navigated to selected point").expect();
});

void test("navigating back to a later message redoes the restore", async (t) => {
  const { cwd, terminal } = await openRestoreDialog(t);
  await terminal.press("Down");
  await terminal.press("Enter"); // Restore.
  await terminal.getByText("Navigated to selected point").expect();
  await terminal.press("Ctrl+C"); // Clears the prompt put back in the editor.
  await navigate(terminal, "done");
  await terminal.getByText("Restore files?").expect();
  await terminal.press("Down");
  await terminal.press("Enter"); // Restore.
  // "Navigated to selected point" is still shown from the first navigation,
  // but "done" only reappears once the chat rerenders at it.
  await terminal.getByText("done").expect();
  assert.deepEqual(await readFiles(cwd), { "a.txt": "A", "c.txt": "c" });
});

void test("a missing snapshot cancels navigation", async (t) => {
  // Outside cwd, as overlapping it disables undo.
  const agentDir = await mkdtemp(join(tmpdir(), "pi-e2e-agent-"));
  t.after(() => rm(agentDir, { recursive: true }));
  const terminal = await startUndo(t, await createProject(t), {
    PI_CODING_AGENT_DIR: agentDir,
  });
  await changeFiles(terminal);
  await rm(join(agentDir, "undo"), { recursive: true });
  await navigate(terminal, "edit a");
  await terminal.getByText("diff failed").expect();
  await terminal.getByText("Navigation cancelled").expect();
});

void test("the project's own git state is left untouched", async (t) => {
  const cwd = await createProject(t);
  const terminal = await startUndo(t, cwd);
  await changeFiles(terminal);
  await git(cwd, "init", "--quiet");
  await git(cwd, "add", "--all");
  await navigate(terminal, "edit a");
  await terminal.getByText("Restore files?").expect();
  await terminal.press("Down");
  await terminal.press("Enter"); // Restore.
  await terminal.getByText("Navigated to selected point").expect();
  const { stdout } = await git(cwd, "status", "--porcelain");
  assert.equal(stdout, "AM a.txt\nAD c.txt\n?? b.txt\n");
});

void test("cwd overlapping the agent dir warns and disables", async (t) => {
  // Runs in home, which contains the agent dir.
  const terminal = await startUndo(t);
  await terminal.submit("hi");
  await terminal.getByText("snapshot failed, disabling").expect();
  await terminal.getByText("overlaps the agent dir").expect();
});
