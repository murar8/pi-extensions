import { test } from "node:test";
import { startPi } from "#e2e/pi.ts";

void test("alt+s swaps the prompt with the stash", async (t) => {
  const terminal = await startPi(t, { extension: "stash" });
  await terminal.type("draft");
  await terminal.getByText("draft").expect();
  await terminal.press("Alt+S");
  await terminal.getByText("draft").expect({ not: true });
  await terminal.press("Alt+S");
  await terminal.getByText("draft").expect();
});
