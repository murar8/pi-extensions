import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { redoTarget, undoTarget } from "./tree.ts";

export default function undo(pi: ExtensionAPI) {
  pi.registerCommand("undo", {
    description: "Go back before the last prompt",
    handler: async (_args, ctx) => {
      ctx.abort();
      await ctx.waitForIdle();
      const target = undoTarget(ctx.sessionManager);
      if (target !== undefined) {
        await ctx.navigateTree(target);
      } else {
        ctx.ui.notify("Nothing to undo", "info");
      }
    },
  });
  pi.registerCommand("redo", {
    description: "Go forward one prompt",
    handler: async (_args, ctx) => {
      ctx.abort();
      await ctx.waitForIdle();
      const target = redoTarget(ctx.sessionManager);
      if (target !== undefined) {
        await ctx.navigateTree(target);
      } else {
        ctx.ui.notify("Nothing to redo", "info");
      }
    },
  });
}
