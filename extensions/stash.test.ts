import assert from "node:assert/strict";
import { test } from "node:test";
import stash from "./stash.ts";
import type { StashPi, StashUI } from "./stash.ts";

type Handler = Parameters<StashPi["registerShortcut"]>[1]["handler"];

class FakeUI implements StashUI {
  text = "";

  getEditorText() {
    return this.text;
  }

  setEditorText(text: string) {
    this.text = text;
  }
}

class FakePi implements StashPi {
  ui = new FakeUI();
  #shortcuts = new Map<string, Handler>();

  constructor() {
    stash(this);
  }

  registerShortcut(key: string, { handler }: { handler: Handler }) {
    this.#shortcuts.set(key, handler);
  }

  press(key: string) {
    this.#shortcuts.get(key)?.({ ui: this.ui });
  }
}

void test("alt+s stashes the prompt and restores it", () => {
  const pi = new FakePi();
  pi.ui.text = "draft";
  pi.press("alt+s");
  assert.equal(pi.ui.text, "");
  pi.press("alt+s");
  assert.equal(pi.ui.text, "draft");
});

void test("alt+s swaps a new prompt with the stash", () => {
  const pi = new FakePi();
  pi.ui.text = "first";
  pi.press("alt+s");
  pi.ui.text = "second";
  pi.press("alt+s");
  assert.equal(pi.ui.text, "first");
  pi.press("alt+s");
  assert.equal(pi.ui.text, "second");
});
