import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { cacheStatus } from "./status.ts";

const model = {
  ...fauxProvider().getModel(),
  promptCache: { short: 300, long: 3600 },
};

// A session with an assistant message sent at time 0.
function session() {
  const m = SessionManager.inMemory();
  m.appendThinkingLevelChange("off");
  m.appendMessage(fauxAssistantMessage("", { timestamp: 0 }));
  return m;
}

function status(options: Partial<Parameters<typeof cacheStatus>[0]> = {}) {
  return cacheStatus({
    model,
    branch: session().getBranch(),
    thinkingLevel: "off",
    now: 60_000,
    idle: true,
    ...options,
  });
}

void describe("cacheStatus", { concurrency: true }, () => {
  void test("is undefined without a model", () => {
    assert.equal(status({ model: undefined }), undefined);
  });

  void test("is undefined without a request", () => {
    const m = SessionManager.inMemory();
    m.appendThinkingLevelChange("off");
    assert.equal(status({ branch: m.getBranch() }), undefined);
  });

  void test("is undefined without a known cache lifetime", () => {
    const { promptCache: _, ...rest } = model;
    const m = session();
    m.appendCompaction("", null, 0);
    assert.equal(status({ model: rest, branch: m.getBranch() }), undefined);
  });

  void test("counts down the short tier", () => {
    assert.equal(status(), "cache warm 4m");
  });

  void test("is warm while running", () => {
    assert.equal(status({ idle: false, now: 300_000 }), "cache warm");
  });

  void test("shows seconds in the last minute", () => {
    assert.equal(status({ now: 30_000 }), "cache warm 4m");
    assert.equal(status({ now: 250_000 }), "cache warm 50s");
  });

  void test("counts down the long tier", () => {
    assert.equal(
      status({ env: { PI_CACHE_RETENTION: "long" } }),
      "cache warm 59m",
    );
  });

  void test("expires", () => {
    assert.equal(status({ now: 300_000 }), "cache cold: expired");
  });

  void test("is cold after compaction", () => {
    const m = session();
    m.appendCompaction("", null, 0);
    assert.equal(status({ branch: m.getBranch() }), "cache cold: compacted");
  });

  void test("is cold after a model change", () => {
    assert.equal(
      status({ model: { ...model, id: "other" } }),
      "cache cold: model changed",
    );
  });

  void test("is cold after a thinking change", () => {
    assert.equal(
      status({ thinkingLevel: "high" }),
      "cache cold: thinking changed",
    );
  });

  void test("ignores errored requests", () => {
    const m = session();
    m.appendMessage(
      fauxAssistantMessage("", { stopReason: "error", timestamp: 30_000 }),
    );
    assert.equal(status({ branch: m.getBranch() }), "cache warm 4m");
  });

  void test("ignores aborted requests", () => {
    const m = session();
    m.appendMessage(
      fauxAssistantMessage("", { stopReason: "aborted", timestamp: 30_000 }),
    );
    assert.equal(status({ branch: m.getBranch() }), "cache warm 4m");
  });

  void test("counts cache warm requests", () => {
    const m = session();
    const { usage } = fauxAssistantMessage("");
    const e = m.appendUsage("cache_warm", model.provider, model.id, usage);
    const now = Date.parse(e.timestamp) + 120_000;
    assert.equal(status({ branch: m.getBranch(), now }), "cache warm 3m");
  });
});
