// Fixture extensions selecting a faux model with scripted replies.

import { fauxProvider } from "@earendil-works/pi-ai";
import type { FauxResponseStep } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Replies to each prompt in scenarios with its responses.
export function fauxFixture(scenarios: Record<string, FauxResponseStep[]>) {
  return function fixture(pi: ExtensionAPI) {
    const provider = fauxProvider();
    pi.registerProvider(provider.provider);
    pi.on("session_start", async () => {
      await pi.setModel(provider.getModel());
    });
    pi.on("before_agent_start", (event) => {
      if (event.messageType !== "user") return;
      const steps = scenarios[event.prompt];
      if (!steps) throw new Error(`No scenario for ${event.prompt}`);
      provider.setResponses(steps);
    });
  };
}
