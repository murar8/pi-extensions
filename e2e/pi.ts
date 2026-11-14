import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { TuiTest } from "@microsoft/tui-test";

const ROOT = join(import.meta.dirname, "..");

interface Options {
  // Loaded alone, a directory in extensions.
  extension: string;
  // Directory pi runs in, home if unset.
  cwd?: string;
  // Passed to pi.
  args?: string[];
  // Added to pi's environment, overriding the defaults.
  env?: Record<string, string>;
}

// Runs pi in terminal with home as its home.
function runPi(
  terminal: TuiTest,
  home: string,
  { extension, cwd = home, args = [], env }: Options,
) {
  return terminal.run(
    join(ROOT, "node_modules/.bin/pi"),
    ["-e", join(ROOT, "extensions", extension, "index.ts"), ...args],
    {
      cwd,
      // run adds env to the host's, so blank the host's.
      env: {
        ...Object.fromEntries(Object.keys(process.env).map((key) => [key, ""])),
        HOME: home,
        // Needed by full-screen programs like less.
        TERM: "xterm-256color",
        PATH: process.env["PATH"] ?? "",
        TMPDIR: tmpdir(),
        PI_OFFLINE: "1",
        ...env,
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

// pi with a fresh home.
export async function startPi(t: TestContext, options: Options) {
  const home = await mkdtemp(join(tmpdir(), "pi-e2e-"));
  const terminal = TuiTest.ephemeral();
  t.after(() => stopPi(t, terminal, home));
  await runPi(terminal, home, options);
  await terminal.getByText("[Extensions]").expect(); // Shown once startup is done.
  return terminal;
}
