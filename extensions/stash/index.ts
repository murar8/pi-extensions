import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function stash(pi: ExtensionAPI) {
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
