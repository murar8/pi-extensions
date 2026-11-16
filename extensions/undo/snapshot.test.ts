import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { findTree, repeats, UNDO_ENTRY_CUSTOM_TYPE } from "./snapshot.ts";

// A session whose methods append an entry and return its id.
class Session {
  manager = SessionManager.inMemory();

  snapshot(tree: string) {
    return this.manager.appendCustomEntry(UNDO_ENTRY_CUSTOM_TYPE, tree);
  }

  user() {
    return this.manager.appendMessage({
      role: "user",
      content: "",
      timestamp: 0,
    });
  }

  assistant() {
    return this.manager.appendMessage(fauxAssistantMessage(""));
  }

  // Snapshots `tree` as index.ts does, skipping a repeat.
  trigger(tree: string) {
    if (!repeats(this.manager.getLeafEntry(), tree)) this.snapshot(tree);
  }

  customMessage() {
    return this.manager.appendCustomMessageEntry("", "", true);
  }

  modelChange() {
    return this.manager.appendModelChange("", "");
  }

  branch(id: string) {
    this.manager.branch(id);
  }

  branchWithSummary(id: string) {
    return this.manager.branchWithSummary(id, "");
  }

  toolResult() {
    return this.manager.appendMessage({
      role: "toolResult",
      toolCallId: "",
      toolName: "",
      content: [],
      isError: false,
      timestamp: 0,
    });
  }

  // The tree /tree offers to restore at `id`.
  findTree(id: string) {
    const branch = this.manager.getBranch(id);
    return findTree(this.manager.getEntries(), branch);
  }
}

void describe("findTree", { concurrency: true }, () => {
  void test("selecting an assistant message restores the files after its turn", () => {
    const s = new Session();
    s.snapshot("tree-1");
    s.user();
    const a1 = s.assistant();
    s.snapshot("tree-2");
    assert.equal(s.findTree(a1), "tree-2");
  });

  void test("selecting a user message restores the files before its prompt", () => {
    const s = new Session();
    s.snapshot("tree-1");
    const u1 = s.user();
    s.assistant();
    s.snapshot("tree-2");
    assert.equal(s.findTree(u1), "tree-1");
  });

  void test("selecting a user message restores the files at its parent message", () => {
    const s = new Session();
    s.snapshot("tree-1");
    s.user();
    const a1 = s.assistant();
    s.snapshot("tree-2");
    s.branch(a1);
    const u2 = s.user();
    assert.equal(s.findTree(u2), "tree-2");
  });

  void test("selecting a user message ignores the snapshots after it", () => {
    const s = new Session();
    s.snapshot("tree-1");
    const u1 = s.user();
    s.snapshot("tree-2");
    assert.equal(s.findTree(u1), "tree-1");
  });

  void test("selecting a message without any snapshot restores nothing", () => {
    const s = new Session();
    const u1 = s.user();
    s.assistant();
    assert.equal(s.findTree(u1), undefined);
  });

  void test("selecting a custom message restores the files before it", () => {
    const s = new Session();
    s.snapshot("tree-1");
    const c1 = s.customMessage();
    s.assistant();
    s.snapshot("tree-2");
    assert.equal(s.findTree(c1), "tree-1");
  });

  void test("selecting a message counts the snapshots after a custom message below it", () => {
    const s = new Session();
    s.snapshot("tree-1");
    s.user();
    const a1 = s.assistant();
    s.snapshot("tree-2");
    s.customMessage();
    s.snapshot("tree-3");
    assert.equal(s.findTree(a1), "tree-3");
  });

  void test("selecting an assistant message without a snapshot restores the previous one", () => {
    const s = new Session();
    s.snapshot("tree-1");
    s.user();
    const a1 = s.assistant();
    assert.equal(s.findTree(a1), "tree-1");
  });

  void test("selecting a snapshot restores exactly it", () => {
    const s = new Session();
    s.snapshot("tree-1");
    s.user();
    s.assistant();
    const t2 = s.snapshot("tree-2");
    s.snapshot("tree-3");
    assert.equal(s.findTree(t2), "tree-2");
  });

  void test("selecting a turn's last tool result restores the files after the turn", () => {
    const s = new Session();
    s.snapshot("tree-1");
    s.user();
    s.assistant();
    s.toolResult();
    const r2 = s.toolResult();
    s.snapshot("tree-2");
    assert.equal(s.findTree(r2), "tree-2");
  });

  void test("selecting an assistant message with tool calls restores the files before its tools", () => {
    const s = new Session();
    s.snapshot("tree-1");
    s.user();
    const a1 = s.assistant();
    s.toolResult();
    s.snapshot("tree-2");
    assert.equal(s.findTree(a1), "tree-1");
  });

  void test("selecting an earlier tool result restores the files before the turn", () => {
    const s = new Session();
    s.snapshot("tree-1");
    s.user();
    s.assistant();
    const r1 = s.toolResult();
    s.toolResult();
    s.snapshot("tree-2");
    assert.equal(s.findTree(r1), "tree-1");
  });

  void test("selecting a message restores the latest snapshot at it on any branch", () => {
    const s = new Session();
    s.snapshot("tree-1");
    s.user();
    const a1 = s.assistant();
    s.snapshot("tree-2");
    s.branch(a1);
    s.snapshot("tree-3");
    assert.equal(s.findTree(a1), "tree-3");
  });

  void test("selecting a message counts the snapshots after its branch summary", () => {
    const s = new Session();
    s.snapshot("tree-1");
    s.user();
    const a1 = s.assistant();
    s.snapshot("tree-2");
    s.branchWithSummary(a1);
    s.snapshot("tree-3");
    assert.equal(s.findTree(a1), "tree-3");
  });

  void test("selecting a non-message entry restores the files as of it", () => {
    const s = new Session();
    s.snapshot("tree-1");
    s.user();
    s.assistant();
    s.snapshot("tree-2");
    const m = s.modelChange();
    s.snapshot("tree-3");
    assert.equal(s.findTree(m), "tree-2");
  });
});

void describe("repeats", { concurrency: true }, () => {
  void test("a snapshot right after an identical one is skipped", () => {
    const s = new Session();
    s.snapshot("tree-1");
    s.trigger("tree-1");
    assert.equal(s.manager.getEntries().length, 1);
  });

  void test("a snapshot matching only a snapshot further up is kept", () => {
    const s = new Session();
    s.snapshot("tree-1");
    s.user();
    const a1 = s.assistant();
    s.snapshot("tree-2");
    s.branch(a1);
    s.snapshot("tree-3");
    s.branch(a1);
    s.trigger("tree-3");
    s.user();
    const a2 = s.assistant();
    s.toolResult();
    s.snapshot("tree-4");
    assert.equal(s.findTree(a2), "tree-3");
  });
});
