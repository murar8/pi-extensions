import assert from "node:assert/strict";
import { getPromptCacheTtlMs } from "@earendil-works/pi-ai";
import type { Api, Model, ProviderEnv } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

type LastRequest =
  | { type: "compacted" }
  | {
      type: "request";
      provider: string;
      model: string;
      timestamp: number;
      thinkingLevel: string | undefined;
    };

// The last request, or why the cache went cold since.
function lastRequest(branch: SessionEntry[]) {
  let last: LastRequest | undefined;
  let level: string | undefined;
  for (const e of branch) {
    if (e.type === "compaction") last = { type: "compacted" };
    else if (e.type === "thinking_level_change") level = e.thinkingLevel;
    else if (e.type === "usage" && e.kind === "cache_warm") {
      last = {
        type: "request",
        provider: e.provider,
        model: e.model,
        timestamp: Date.parse(e.timestamp),
        thinkingLevel: level,
      };
    } else if (
      e.type === "message" &&
      e.message.role === "assistant" &&
      e.message.stopReason !== "error" &&
      e.message.stopReason !== "aborted"
    ) {
      last = {
        type: "request",
        provider: e.message.provider,
        model: e.message.model,
        timestamp: e.message.timestamp,
        thinkingLevel: level,
      };
    }
  }
  return last;
}

export type ColdReason =
  "compacted" | "model changed" | "thinking changed" | "expired";

export type CacheStatus =
  | { type: "warm"; left: number; ttl: number }
  | { type: "cold"; reason: ColdReason };

interface CacheStatusOptions {
  model: Model<Api> | undefined;
  branch: SessionEntry[];
  thinkingLevel: string;
  now: number;
  idle: boolean;
  env?: ProviderEnv;
}

export function cacheStatus({
  model,
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
  const last = lastRequest(branch);
  if (!last) {
    return;
  }
  if (last.type === "compacted") {
    return { type: "cold", reason: "compacted" };
  }
  if (last.provider !== model.provider || last.model !== model.id) {
    return { type: "cold", reason: "model changed" };
  }
  if (last.thinkingLevel !== thinkingLevel) {
    return { type: "cold", reason: "thinking changed" };
  }

  const left = ttl + last.timestamp - now;
  if (left <= 0) {
    return { type: "cold", reason: "expired" };
  } else {
    return { type: "warm", left, ttl };
  }
}

function formatDuration(milliseconds: number) {
  return Temporal.Duration.from({ milliseconds })
    .round({
      largestUnit: "hours",
      smallestUnit: milliseconds < 60_000 ? "seconds" : "minutes",
      roundingMode: "floor",
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
