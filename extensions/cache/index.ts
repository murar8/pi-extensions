import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { mixColors } from "@earendil-works/pi-tui";
import { cacheStatus, heat, statusText } from "./status.ts";
import type { CacheStatus } from "./status.ts";

// Fades from success through warning to muted as the cache cools.
function statusColor(
  status: CacheStatus,
  { success, warning, muted }: Theme["colors"],
) {
  const h = heat(status);
  if (h < 0.5) {
    return mixColors(muted, warning, h * 2);
  } else {
    return mixColors(warning, success, h * 2 - 1);
  }
}

function renderStatus(status: CacheStatus | undefined, theme: Theme) {
  if (!status) return;
  return theme.style(statusText(status), {
    fg: statusColor(status, theme.colors),
  });
}

export default function cache(pi: ExtensionAPI) {
  let timer: NodeJS.Timeout | undefined;

  function update(_: unknown, ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    const status = cacheStatus({
      model: ctx.model,
      branch: ctx.sessionManager.getBranch(),
      thinkingLevel: pi.getThinkingLevel(),
      now: Date.now(),
      idle: ctx.isIdle(),
    });
    ctx.ui.setStatus("cache", renderStatus(status, ctx.ui.theme));
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
