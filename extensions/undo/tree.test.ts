import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { redoTarget, undoTarget } from "./tree.ts";

// Appenders that add an entry to `m` and return its id.
function user(m: SessionManager) {
  return m.appendMessage({ role: "user", content: "", timestamp: 0 });
}

function assistant(m: SessionManager) {
  return m.appendMessage(fauxAssistantMessage(""));
}

function custom(m: SessionManager) {
  return m.appendCustomEntry("test");
}

void describe("undoTarget", { concurrency: true }, () => {
  void test("is undefined without a user message", () => {
    const m = SessionManager.inMemory();
    assistant(m);
    assert.equal(undoTarget(m), undefined);
  });

  void test("is the last user message on the branch", () => {
    const m = SessionManager.inMemory();
    user(m);
    assistant(m);
    const u2 = user(m);
    assistant(m);
    assert.equal(undoTarget(m), u2);
  });

  void test("ignores user messages off the branch", () => {
    const m = SessionManager.inMemory();
    const u1 = user(m);
    const a1 = assistant(m);
    user(m);
    m.branch(a1);
    assert.equal(undoTarget(m), u1);
  });
});

void describe("redoTarget", { concurrency: true }, () => {
  void test("is the prompt after the undone one", () => {
    const m = SessionManager.inMemory();
    user(m);
    const a1 = assistant(m);
    user(m);
    assistant(m);
    const u3 = user(m);
    assistant(m);
    m.branch(a1);
    assert.equal(redoTarget(m), u3);
  });

  void test("finishes the turn from a user message", () => {
    const m = SessionManager.inMemory();
    user(m);
    assistant(m);
    const u2 = user(m);
    assistant(m);
    const u3 = user(m);
    assistant(m);
    user(m);
    assistant(m);
    m.branch(u2);
    assert.equal(redoTarget(m), u3);
  });

  void test("is the latest entry when redoing the latest turn", () => {
    const m = SessionManager.inMemory();
    user(m);
    const a1 = assistant(m);
    user(m);
    const a2 = assistant(m);
    m.branch(a1);
    assert.equal(redoTarget(m), a2);
  });

  void test("follows the newest branch at a fork", () => {
    const m = SessionManager.inMemory();
    user(m);
    const a1 = assistant(m);
    user(m);
    assistant(m);
    m.branch(a1);
    user(m);
    const a2b = assistant(m);
    m.branch(a1);
    assert.equal(redoTarget(m), a2b);
  });

  void test("ignores state-only entries off the path", () => {
    const m = SessionManager.inMemory();
    user(m);
    const a1 = assistant(m);
    user(m);
    const a2 = assistant(m);
    m.branch(a1);
    custom(m);
    assert.equal(redoTarget(m), a2);
  });

  void test("is undefined at the tip", () => {
    const m = SessionManager.inMemory();
    user(m);
    assistant(m);
    custom(m);
    assert.equal(redoTarget(m), undefined);
  });

  void test("redoes the first prompt under a state-only root", () => {
    const m = SessionManager.inMemory();
    const root = custom(m);
    user(m);
    const a1 = assistant(m);
    m.branch(root);
    assert.equal(redoTarget(m), a1);
  });

  void test("redoes the first prompt from a state-only root", () => {
    const m = SessionManager.inMemory();
    user(m);
    const a1 = assistant(m);
    m.resetLeaf();
    custom(m);
    assert.equal(redoTarget(m), a1);
  });

  void test("redoes the first prompt from before the root", () => {
    const m = SessionManager.inMemory();
    user(m);
    const a1 = assistant(m);
    m.resetLeaf();
    assert.equal(redoTarget(m), a1);
  });
});
