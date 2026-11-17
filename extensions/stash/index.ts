import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function stash(pi: ExtensionAPI) {
  const stack: string[] = [];
  pi.registerShortcut("alt+s", {
    description: "Stash the prompt, or restore the last stashed one",
    handler: ({ ui }) => {
      const text = ui.getEditorText();
      let next = "";
      if (text.trim()) stack.push(text);
      else next = stack.pop() ?? "";
      ui.setEditorText(next);
    },
  });
}
