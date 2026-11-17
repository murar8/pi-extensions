import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { fauxFixture } from "#e2e/faux.ts";

const CHANGE_FILES = fauxAssistantMessage(
  [
    fauxToolCall("write", { path: "a.txt", content: "A" }),
    fauxToolCall("bash", { command: "rm b.txt" }),
    fauxToolCall("write", { path: "c.txt", content: "c" }),
  ],
  { stopReason: "toolUse" },
);

export default fauxFixture({
  "edit a, delete b, create c": [CHANGE_FILES, fauxAssistantMessage("done")],
  hi: [fauxAssistantMessage("hello")],
});
