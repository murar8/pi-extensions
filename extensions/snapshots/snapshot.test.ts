import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { findTree, repeats, ENTRY_CUSTOM_TYPE } from "./snapshot.ts";

// Appenders that add an entry to `m` and return its id.
function snapshot(m: SessionManager, tree: string) {
  return m.appendCustomEntry(ENTRY_CUSTOM_TYPE, tree);
}

function user(m: SessionManager) {
  return m.appendMessage({ role: "user", content: "", timestamp: 0 });
}

function assistant(m: SessionManager) {
  return m.appendMessage(fauxAssistantMessage(""));
}

function customMessage(m: SessionManager) {
  return m.appendCustomMessageEntry("", "", true);
}

function toolResult(m: SessionManager) {
  return m.appendMessage({
    role: "toolResult",
    toolCallId: "",
    toolName: "",
    content: [],
    isError: false,
    timestamp: 0,
  });
}

// Snapshots `tree` as index.ts does, skipping a repeat.
function trigger(m: SessionManager, tree: string) {
  if (!repeats(m.getLeafEntry(), tree)) snapshot(m, tree);
}

// The tree /tree offers to restore at `id`.
function treeAt(m: SessionManager, id: string) {
  return findTree(m.getEntries(), m.getBranch(id));
}

void describe("findTree", { concurrency: true }, () => {
  void test("selecting an assistant message restores the files after its turn", () => {
    const m = SessionManager.inMemory();
    snapshot(m, "tree-1");
    user(m);
    const a1 = assistant(m);
    snapshot(m, "tree-2");
    assert.equal(treeAt(m, a1), "tree-2");
  });

  void test("selecting a user message restores the files before its prompt", () => {
    const m = SessionManager.inMemory();
    snapshot(m, "tree-1");
    const u1 = user(m);
    assistant(m);
    snapshot(m, "tree-2");
    assert.equal(treeAt(m, u1), "tree-1");
  });

  void test("selecting a user message restores the files at its parent message", () => {
    const m = SessionManager.inMemory();
    snapshot(m, "tree-1");
    user(m);
    const a1 = assistant(m);
    snapshot(m, "tree-2");
    m.branch(a1);
    const u2 = user(m);
    assert.equal(treeAt(m, u2), "tree-2");
  });

  void test("selecting a user message ignores the snapshots after it", () => {
    const m = SessionManager.inMemory();
    snapshot(m, "tree-1");
    const u1 = user(m);
    snapshot(m, "tree-2");
    assert.equal(treeAt(m, u1), "tree-1");
  });

  void test("selecting a message without any snapshot restores nothing", () => {
    const m = SessionManager.inMemory();
    const u1 = user(m);
    assistant(m);
    assert.equal(treeAt(m, u1), undefined);
  });

  void test("selecting a custom message restores the files before it", () => {
    const m = SessionManager.inMemory();
    snapshot(m, "tree-1");
    const c1 = customMessage(m);
    assistant(m);
    snapshot(m, "tree-2");
    assert.equal(treeAt(m, c1), "tree-1");
  });

  void test("selecting a message looks past a custom message after it", () => {
    const m = SessionManager.inMemory();
    snapshot(m, "tree-1");
    user(m);
    const a1 = assistant(m);
    customMessage(m);
    snapshot(m, "tree-2");
    assert.equal(treeAt(m, a1), "tree-2");
  });

  void test("selecting an assistant message without a snapshot restores the previous one", () => {
    const m = SessionManager.inMemory();
    snapshot(m, "tree-1");
    user(m);
    const a1 = assistant(m);
    assert.equal(treeAt(m, a1), "tree-1");
  });

  void test("selecting a snapshot restores exactly it", () => {
    const m = SessionManager.inMemory();
    snapshot(m, "tree-1");
    user(m);
    assistant(m);
    const t2 = snapshot(m, "tree-2");
    snapshot(m, "tree-3");
    assert.equal(treeAt(m, t2), "tree-2");
  });

  void test("selecting a turn's last tool result restores the files after the turn", () => {
    const m = SessionManager.inMemory();
    snapshot(m, "tree-1");
    user(m);
    assistant(m);
    toolResult(m);
    const r2 = toolResult(m);
    snapshot(m, "tree-2");
    assert.equal(treeAt(m, r2), "tree-2");
  });

  void test("selecting an assistant message with tool calls restores the files before its tools", () => {
    const m = SessionManager.inMemory();
    snapshot(m, "tree-1");
    user(m);
    const a1 = assistant(m);
    toolResult(m);
    snapshot(m, "tree-2");
    assert.equal(treeAt(m, a1), "tree-1");
  });

  void test("selecting an earlier tool result restores the files before the turn", () => {
    const m = SessionManager.inMemory();
    snapshot(m, "tree-1");
    user(m);
    assistant(m);
    const r1 = toolResult(m);
    toolResult(m);
    snapshot(m, "tree-2");
    assert.equal(treeAt(m, r1), "tree-1");
  });

  void test("selecting a message ignores the snapshots of later visits", () => {
    const m = SessionManager.inMemory();
    snapshot(m, "tree-1");
    user(m);
    const a1 = assistant(m);
    snapshot(m, "tree-2");
    m.branch(a1);
    snapshot(m, "tree-3");
    assert.equal(treeAt(m, a1), "tree-2");
  });

  void test("selecting a message ignores the snapshots after a later branch summary", () => {
    const m = SessionManager.inMemory();
    snapshot(m, "tree-1");
    user(m);
    const a1 = assistant(m);
    snapshot(m, "tree-2");
    m.branchWithSummary(a1, "");
    snapshot(m, "tree-3");
    assert.equal(treeAt(m, a1), "tree-2");
  });

  void test("selecting a non-message entry restores the files as of it", () => {
    const m = SessionManager.inMemory();
    snapshot(m, "tree-1");
    user(m);
    assistant(m);
    snapshot(m, "tree-2");
    const mc = m.appendModelChange("", "");
    snapshot(m, "tree-3");
    assert.equal(treeAt(m, mc), "tree-2");
  });
});

void describe("repeats", { concurrency: true }, () => {
  void test("a snapshot right after an identical one is skipped", () => {
    const m = SessionManager.inMemory();
    snapshot(m, "tree-1");
    trigger(m, "tree-1");
    assert.equal(m.getEntries().length, 1);
  });

  void test("a snapshot matching only a snapshot further up is kept", () => {
    const m = SessionManager.inMemory();
    snapshot(m, "tree-1");
    user(m);
    const a1 = assistant(m);
    snapshot(m, "tree-2");
    m.branch(a1);
    snapshot(m, "tree-3");
    m.branch(a1);
    trigger(m, "tree-3");
    user(m);
    const a2 = assistant(m);
    toolResult(m);
    snapshot(m, "tree-4");
    assert.equal(treeAt(m, a2), "tree-3");
  });
});
