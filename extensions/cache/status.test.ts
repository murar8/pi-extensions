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
  const message = fauxAssistantMessage("", { timestamp: 0 });
  m.appendMessage({ ...message, thinkingLevel: "off" });
  return m;
}

function status({
  session: m = session(),
  ...options
}: Partial<Parameters<typeof cacheStatus>[0]> & {
  session?: SessionManager;
} = {}) {
  return cacheStatus({
    model,
    entries: m.getEntries(),
    branch: m.getBranch(),
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
    assert.equal(status({ session: SessionManager.inMemory() }), undefined);
  });

  void test("is undefined without a known cache lifetime", () => {
    const { promptCache: _, ...rest } = model;
    // Hidden even when it would be cold.
    const m = session();
    m.appendCompaction("", null, 0);
    assert.equal(status({ model: rest, session: m }), undefined);
  });

  void test("counts down", () => {
    assert.deepEqual(status(), warm(240_000));
  });

  void test("caps at the lifetime", () => {
    assert.deepEqual(status({ now: -60_000 }), warm(300_000));
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
    assert.deepEqual(status({ session: m }), cold("compacted"));
  });

  void test("is cold after branching", () => {
    const m = session();
    const id = m.getLeafId();
    assert.ok(id !== null);
    m.appendMessage(fauxAssistantMessage(""));
    m.branch(id);
    assert.deepEqual(status({ session: m }), cold("branched"));
  });

  void test("is cold after branching with a summary", () => {
    const m = session();
    const id = m.getLeafId();
    assert.ok(id !== null);
    m.appendMessage(fauxAssistantMessage(""));
    m.branchWithSummary(id, "");
    assert.deepEqual(status({ session: m }), cold("branched"));
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
    assert.deepEqual(status({ session: m }), warm(240_000));
  });

  void test("ignores aborted requests", () => {
    const m = session();
    m.appendMessage(
      fauxAssistantMessage("", { stopReason: "aborted", timestamp: 30_000 }),
    );
    assert.deepEqual(status({ session: m }), warm(240_000));
  });

  void test("counts cache warm requests", () => {
    const m = session();
    const { usage } = fauxAssistantMessage("");
    const e = m.appendUsage("cache_warm", model.provider, "other", usage);
    const now = Date.parse(e.timestamp) + 120_000;
    assert.deepEqual(status({ session: m, now }), warm(180_000));
  });

  void test("ignores cache warm requests after compaction", () => {
    const m = session();
    m.appendCompaction("", null, 0);
    const { usage } = fauxAssistantMessage("");
    m.appendUsage("cache_warm", model.provider, model.id, usage);
    assert.deepEqual(status({ session: m }), cold("compacted"));
  });
});

void describe("statusText", { concurrency: true }, () => {
  void test("counts down in minutes", () => {
    assert.equal(statusText(warm(150_000)), "cache warm 2m");
  });

  void test("shows hours", () => {
    assert.equal(statusText(warm(3_660_000)), "cache warm 1h 1m");
  });

  void test("shows seconds in the last minute", () => {
    assert.equal(statusText(warm(50_000)), "cache warm 50s");
  });

  void test("rounds up the last second", () => {
    assert.equal(statusText(warm(500)), "cache warm 1s");
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
