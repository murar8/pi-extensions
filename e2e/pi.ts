import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { TuiTest } from "@microsoft/tui-test";

const root = join(import.meta.dirname, "..");

// Runs pi in terminal with only extension, a file in extensions, loaded, in
// home.
function runPi(terminal: TuiTest, home: string, extension: string) {
  return terminal.run(
    join(root, "node_modules/.bin/pi"),
    ["-e", join(root, "extensions", `${extension}.ts`)],
    {
      cwd: home,
      // run adds env to the host's, so blank the host's.
      env: {
        ...Object.fromEntries(Object.keys(process.env).map((key) => [key, ""])),
        HOME: home,
        PATH: process.env["PATH"] ?? "",
        TMPDIR: tmpdir(),
        PI_OFFLINE: "1",
      },
    },
  );
}

// Shows the screen if t failed, as locator errors don't, then closes terminal
// and removes home.
async function stopPi(t: TestContext, terminal: TuiTest, home: string) {
  if (!t.passed) console.error(await terminal.text());
  await terminal.closeQuiet();
  await rm(home, { recursive: true });
}

// pi with only extension loaded, in a fresh home.
export async function startPi(t: TestContext, extension: string) {
  const home = await mkdtemp(join(tmpdir(), "pi-e2e-"));
  const terminal = TuiTest.ephemeral();
  t.after(() => stopPi(t, terminal, home));
  await runPi(terminal, home, extension);
  await terminal.getByText("[Extensions]").expect(); // Shown once startup is done.
  return terminal;
}
