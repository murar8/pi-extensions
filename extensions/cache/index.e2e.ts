import { join } from "node:path";
import { suite, test } from "node:test";
import type { TestContext } from "node:test";
import { startPi } from "#e2e/pi.ts";

// pi with cache and its fixture, in the dark theme with truecolor so colors
// are exact, with env added to its environment.
async function startCache(t: TestContext, env?: Record<string, string>) {
  return startPi(t, {
    extension: "cache",
    args: [
      "-e",
      join(import.meta.dirname, "index.fixture.ts"),
      "--use-theme",
      "dark",
    ],
    env: { COLORTERM: "truecolor", ...env },
  });
}

// Dark theme colors.
const success = "#68b78d";
const muted = "#9da5a9";

void suite("cache", { concurrency: true }, () => {
  void test("counts down after a reply", async (t) => {
    const terminal = await startCache(t, { PI_CACHE_RETENTION: "long" });
    await terminal.submit("hi");
    await terminal.getByText("reply").expect();
    await terminal
      .getByText("cache warm 23h 59m")
      .getByStyle({ foreground: success })
      .expect();
  });

  void test("expires", async (t) => {
    const terminal = await startCache(t);
    await terminal.submit("hi");
    await terminal.getByText("reply").expect();
    await terminal
      .getByText("cache cold: expired")
      .getByStyle({ foreground: muted })
      .expect();
  });
});
