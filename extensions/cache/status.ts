import assert from "node:assert/strict";
import { getPromptCacheTtlMs } from "@earendil-works/pi-ai";
import type {
  Api,
  AssistantMessage,
  Model,
  ProviderEnv,
} from "@earendil-works/pi-ai";
import type {
  SessionEntry,
  SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";

type LastRequest =
  | { type: "cold"; reason: "compacted" | "branched" }
  | {
      type: "request";
      provider: string;
      model: string;
      timestamp: number;
      thinkingLevel: string | undefined;
    };

function isCompletedResponse(
  e: SessionEntry,
): e is SessionMessageEntry & { message: AssistantMessage } {
  return (
    e.type === "message" &&
    e.message.role === "assistant" &&
    e.message.stopReason !== "error" &&
    e.message.stopReason !== "aborted"
  );
}

// The last request, or why the cache went cold since.
function lastRequest(
  entries: SessionEntry[],
  branch: SessionEntry[],
): LastRequest | undefined {
  const newest = entries.findLast(isCompletedResponse);
  if (newest && !branch.some((e) => e.id === newest.id)) {
    return { type: "cold", reason: "branched" };
  }
  let last: LastRequest | undefined;
  for (const e of branch) {
    if (e.type === "compaction") last = { type: "cold", reason: "compacted" };
    else if (
      e.type === "usage" &&
      e.kind === "cache_warm" &&
      last?.type === "request"
    ) {
      // Re-sends the last request, but may report a different model id.
      last.timestamp = Date.parse(e.timestamp);
    } else if (isCompletedResponse(e)) {
      last = {
        type: "request",
        provider: e.message.provider,
        model: e.message.model,
        timestamp: e.message.timestamp,
        thinkingLevel: e.message.thinkingLevel,
      };
    }
  }
  return last;
}

export type ColdReason =
  "compacted" | "branched" | "model changed" | "thinking changed" | "expired";

export type CacheStatus =
  | { type: "warm"; left: number; ttl: number }
  | { type: "cold"; reason: ColdReason };

interface CacheStatusOptions {
  model: Model<Api> | undefined;
  entries: SessionEntry[];
  branch: SessionEntry[];
  thinkingLevel: string;
  now: number;
  idle: boolean;
  env?: ProviderEnv;
}

export function cacheStatus({
  model,
  entries,
  branch,
  thinkingLevel,
  now,
  idle,
  env,
}: CacheStatusOptions): CacheStatus | undefined {
  if (!model) {
    return;
  }
  const ttl = getPromptCacheTtlMs(model, { env });
  if (ttl === undefined) {
    return;
  }
  assert.ok(ttl > 0, "prompt cache TTL must be positive");
  if (!idle) {
    return { type: "warm", left: ttl, ttl };
  }
  const last = lastRequest(entries, branch);
  if (!last) {
    return;
  }
  if (last.type === "cold") {
    return last;
  }
  if (last.provider !== model.provider || last.model !== model.id) {
    return { type: "cold", reason: "model changed" };
  }
  if (last.thinkingLevel !== thinkingLevel) {
    return { type: "cold", reason: "thinking changed" };
  }

  const left = Math.min(ttl, ttl + last.timestamp - now);
  if (left <= 0) {
    return { type: "cold", reason: "expired" };
  } else {
    return { type: "warm", left, ttl };
  }
}

// Rounds up in the last minute, so it never shows 0 while warm.
function formatDuration(milliseconds: number) {
  const lastMinute = milliseconds < 60_000;
  return Temporal.Duration.from({ milliseconds })
    .round({
      largestUnit: "hours",
      smallestUnit: lastMinute ? "seconds" : "minutes",
      roundingMode: lastMinute ? "ceil" : "floor",
    })
    .toLocaleString("en", {
      style: "narrow",
    });
}

export function statusText(status: CacheStatus) {
  switch (status.type) {
    case "warm":
      return `cache warm ${formatDuration(status.left)}`;
    case "cold":
      return `cache cold: ${status.reason}`;
  }
}

export function heat(status: CacheStatus) {
  switch (status.type) {
    case "warm":
      return status.left / status.ttl;
    case "cold":
      return 0;
  }
}
