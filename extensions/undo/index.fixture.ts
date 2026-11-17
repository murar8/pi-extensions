import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type {
  AssistantMessage,
  FauxResponseFactory,
} from "@earendil-works/pi-ai";
import { fauxFixture } from "#e2e/faux.ts";

// Replies only once aborted.
async function hang(...[, options]: Parameters<FauxResponseFactory>) {
  return new Promise<AssistantMessage>((resolve) => {
    options?.signal?.addEventListener("abort", () => {
      resolve(fauxAssistantMessage(""));
    });
  });
}

// Writes content to a.txt, then replies with text.
function writeThenReply(content: string, text: string) {
  const call = fauxToolCall("write", { path: "a.txt", content });
  return [
    fauxAssistantMessage([call], { stopReason: "toolUse" }),
    fauxAssistantMessage(text),
  ];
}

export default fauxFixture({
  one: writeThenReply("1", "reply one"),
  two: writeThenReply("2", "reply two"),
  hang: [hang],
});
