import { join } from "node:path";
import { suite, test } from "node:test";
import { startPi } from "#e2e/pi.ts";

const fixture = join(import.meta.dirname, "index.fixture.ts");

void suite("cache", { concurrency: true }, () => {
  void test("counts down after a reply", async (t) => {
    const terminal = await startPi(t, {
      extension: "cache",
      args: ["-e", fixture],
      env: { PI_CACHE_RETENTION: "long" },
    });
    await terminal.submit("hi");
    await terminal.getByText("reply").expect();
    await terminal.getByText("cache warm 4m").expect();
  });

  void test("expires", async (t) => {
    const terminal = await startPi(t, {
      extension: "cache",
      args: ["-e", fixture],
    });
    await terminal.submit("hi");
    await terminal.getByText("reply").expect();
    await terminal.getByText("cache cold: expired").expect();
  });
});
