import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { cacheStatus } from "./status.ts";

export default function cache(pi: ExtensionAPI) {
  let timer: NodeJS.Timeout | undefined;

  function update(_: unknown, ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(
      "cache",
      cacheStatus({
        model: ctx.model,
        branch: ctx.sessionManager.getBranch(),
        thinkingLevel: pi.getThinkingLevel(),
        now: Date.now(),
        idle: ctx.isIdle(),
      }),
    );
  }

  // Refresh right away on events that change the status, instead of on the
  // next tick.
  pi.on("agent_start", update);
  pi.on("agent_settled", update);
  pi.on("model_select", update);
  pi.on("thinking_level_select", update);
  pi.on("session_compact", update);
  pi.on("session_tree", update);

  pi.on("session_start", (event, ctx) => {
    update(event, ctx);
    if (!ctx.hasUI) return;
    timer = setInterval(update, 1000, event, ctx);
  });

  pi.on("session_shutdown", () => {
    clearInterval(timer);
  });
}
