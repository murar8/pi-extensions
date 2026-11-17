import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Selects a faux model whose cache lasts 1ms short and a day long, replying to
// every prompt. A day is long enough that a fresh cache colors as success.
export default function fixture(pi: ExtensionAPI) {
  const provider = fauxProvider();
  pi.registerProvider(provider.provider);
  pi.on("session_start", async () => {
    const model = provider.getModel();
    await pi.setModel({
      ...model,
      promptCache: { short: 0.001, long: 86_400 },
    });
  });
  pi.on("before_agent_start", () => {
    provider.setResponses([() => fauxAssistantMessage("reply")]);
  });
}
