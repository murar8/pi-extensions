import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { cacheStatus, heat, statusText } from "./status.ts";
import type { CacheStatus, ColdReason } from "./status.ts";

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

function warm(left: number): CacheStatus {
  return { type: "warm", left, ttl: 300_000 };
}

function cold(reason: ColdReason): CacheStatus {
  return { type: "cold", reason };
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

  void test("counts down", () => {
    assert.deepEqual(status(), warm(240_000));
  });

  void test("is full while running", () => {
    assert.deepEqual(status({ idle: false, now: 300_000 }), warm(300_000));
  });

  void test("uses the long tier", () => {
    assert.deepEqual(status({ env: { PI_CACHE_RETENTION: "long" } }), {
      type: "warm",
      left: 3_540_000,
      ttl: 3_600_000,
    });
  });

  void test("expires", () => {
    assert.deepEqual(status({ now: 300_000 }), cold("expired"));
  });

  void test("is cold after compaction", () => {
    const m = session();
    m.appendCompaction("", null, 0);
    assert.deepEqual(status({ branch: m.getBranch() }), cold("compacted"));
  });

  void test("is cold after a model change", () => {
    assert.deepEqual(
      status({ model: { ...model, id: "other" } }),
      cold("model changed"),
    );
  });

  void test("is cold after a thinking change", () => {
    assert.deepEqual(
      status({ thinkingLevel: "high" }),
      cold("thinking changed"),
    );
  });

  void test("ignores errored requests", () => {
    const m = session();
    m.appendMessage(
      fauxAssistantMessage("", { stopReason: "error", timestamp: 30_000 }),
    );
    assert.deepEqual(status({ branch: m.getBranch() }), warm(240_000));
  });

  void test("ignores aborted requests", () => {
    const m = session();
    m.appendMessage(
      fauxAssistantMessage("", { stopReason: "aborted", timestamp: 30_000 }),
    );
    assert.deepEqual(status({ branch: m.getBranch() }), warm(240_000));
  });

  void test("counts cache warm requests", () => {
    const m = session();
    const { usage } = fauxAssistantMessage("");
    const e = m.appendUsage("cache_warm", model.provider, model.id, usage);
    const now = Date.parse(e.timestamp) + 120_000;
    assert.deepEqual(status({ branch: m.getBranch(), now }), warm(180_000));
  });
});

void describe("statusText", { concurrency: true }, () => {
  void test("counts down in minutes", () => {
    assert.equal(statusText(warm(150_000)), "cache warm 2m");
  });

  void test("shows seconds in the last minute", () => {
    assert.equal(statusText(warm(50_000)), "cache warm 50s");
  });

  void test("shows why it is cold", () => {
    assert.equal(statusText(cold("expired")), "cache cold: expired");
  });
});

void describe("heat", { concurrency: true }, () => {
  void test("is the fraction of time left", () => {
    assert.equal(heat(warm(150_000)), 0.5);
  });

  void test("is none when cold", () => {
    assert.equal(heat(cold("expired")), 0);
  });
});
