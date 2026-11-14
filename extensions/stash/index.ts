import type {
  ExtensionFactory,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";

export type StashUI = Pick<
  ExtensionUIContext,
  "getEditorText" | "setEditorText"
>;

export interface StashContext {
  ui: StashUI;
}

export interface StashShortcut {
  description: string;
  handler: (ctx: StashContext) => void;
}

export interface StashPi {
  registerShortcut: (shortcut: KeyId, options: StashShortcut) => void;
}

function stash(pi: StashPi) {
  let stashed = "";
  pi.registerShortcut("alt+s", {
    description: "Swap the prompt with the stash",
    handler: ({ ui }) => {
      const text = ui.getEditorText();
      ui.setEditorText(stashed);
      stashed = text;
    },
  });
}

export default stash satisfies ExtensionFactory;
