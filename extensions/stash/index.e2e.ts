import { suite, test } from "node:test";
import { startPi } from "#e2e/pi.ts";

void suite("stash", { concurrency: true }, () => {
  void test("alt+s stashes the prompt or restores the last stashed one", async (t) => {
    const terminal = await startPi(t, { extension: "stash" });
    await terminal.type("first");
    await terminal.getByText("first").expect();
    await terminal.press("Alt+S");
    await terminal.getByText("first").expect({ not: true });
    await terminal.type("second");
    await terminal.getByText("second").expect();
    await terminal.press("Alt+S");
    await terminal.getByText("second").expect({ not: true });
    await terminal.press("Alt+S");
    await terminal.getByText("second").expect();
    await terminal.getByText("first").expect({ not: true });
    await terminal.press("Ctrl+U");
    await terminal.press("Alt+S");
    await terminal.getByText("first").expect();
  });
});
