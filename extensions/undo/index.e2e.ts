import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { suite, test } from "node:test";
import type { TuiTest } from "@microsoft/tui-test";
import { startPi } from "#e2e/pi.ts";

const fixture = join(import.meta.dirname, "index.fixture.ts");

// Submits text, then waits for its reply and the end of the run, as text sent
// mid-run steers it, skipping the fixture's replies.
async function prompt(terminal: TuiTest, text: string) {
  await terminal.submit(text);
  await terminal.getByText(`reply ${text}`).expect();
  await terminal.getByText("Working").expect({ not: true });
}

// Picks Keep in the snapshots restore dialog.
async function keepFiles(terminal: TuiTest) {
  await terminal.getByText("Restore files?").expect();
  await terminal.press("Down");
  await terminal.press("Down");
  await terminal.getByText("→ Keep").expect();
  await terminal.press("Enter");
}

void suite("undo", { concurrency: true }, () => {
  void test("a fresh session has nothing to undo or redo", async (t) => {
    const terminal = await startPi(t, { extension: "undo" });
    await terminal.submit("/undo");
    await terminal.getByText("Nothing to undo").expect();
    await terminal.submit("/redo");
    await terminal.getByText("Nothing to redo").expect();
  });

  void test("/redo reverses /undo", async (t) => {
    const terminal = await startPi(t, {
      extension: "undo",
      args: ["-e", fixture],
    });
    await prompt(terminal, "one");
    await prompt(terminal, "two");
    await terminal.submit("/undo");
    await terminal.getByText("reply two").expect({ not: true });
    await terminal.getByText("reply one").expect();
    await terminal.press("Ctrl+U"); // Clears the undone prompt from the editor.
    await terminal.submit("/redo");
    await terminal.getByText("reply two").expect();
  });

  void test("/undo stops a streaming reply", async (t) => {
    const terminal = await startPi(t, {
      extension: "undo",
      args: ["-e", fixture],
    });
    await prompt(terminal, "one");
    await terminal.submit("hang");
    await terminal.getByText("Working").expect();
    await terminal.submit("/undo");
    await terminal.getByText("Navigated to selected point").expect();
    await terminal.getByText("Working").expect({ not: true });
    await terminal.press("Ctrl+U");
    await terminal.getByText("hang").expect({ not: true });
    await terminal.getByText("reply one").expect();
  });

  void test("/redo ignores snapshots kept off the path", async (t) => {
    // Outside home, as overlapping the agent dir disables snapshots.
    const cwd = await mkdtemp(join(tmpdir(), "pi-e2e-"));
    t.after(async () => rm(cwd, { recursive: true }));
    const snapshots = join(import.meta.dirname, "../snapshots/index.ts");
    const terminal = await startPi(t, {
      extension: "undo",
      cwd,
      args: ["-e", snapshots, "-e", fixture],
    });
    await prompt(terminal, "one");
    await prompt(terminal, "two");
    await terminal.submit("/undo");
    await keepFiles(terminal);
    await terminal.getByText("reply two").expect({ not: true });
    await terminal.press("Ctrl+U");
    // Snapshots the kept files at the undo point, off the path.
    await terminal.submit("/redo");
    await terminal.getByText("reply two").expect();
    await terminal.submit("/undo");
    await keepFiles(terminal);
    await terminal.getByText("reply two").expect({ not: true });
    await terminal.press("Ctrl+U");
    await terminal.submit("/redo");
    await terminal.getByText("reply two").expect();
  });
});
