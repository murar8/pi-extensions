import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Selects a faux model whose cache lasts 1s short and 300s long, replying to
// every prompt.
export default function fixture(pi: ExtensionAPI) {
  const provider = fauxProvider();
  pi.registerProvider(provider.provider);
  pi.on("session_start", async () => {
    const model = provider.getModel();
    await pi.setModel({ ...model, promptCache: { short: 1, long: 300 } });
  });
  pi.on("before_agent_start", () => {
    provider.setResponses([() => fauxAssistantMessage("reply")]);
  });
}
