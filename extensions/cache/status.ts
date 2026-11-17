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
function lastRequest(branch: SessionEntry[]): LastRequest | undefined {
  let last: LastRequest | undefined;
  let level: string | undefined;
  for (const e of branch) {
    if (e.type === "compaction") last = { type: "compacted" };
    if (e.type === "thinking_level_change") level = e.thinkingLevel;
    if (e.type === "usage" && e.kind === "cache_warm") {
      last = {
        type: "request",
        provider: e.provider,
        model: e.model,
        timestamp: Date.parse(e.timestamp),
        thinkingLevel: level,
      };
    }
    if (
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
}: CacheStatusOptions) {
  if (!model) {
    return undefined;
  }
  const ttl = getPromptCacheTtlMs(model, { env });
  if (ttl === undefined) {
    return undefined;
  }
  if (!idle) {
    return "cache warm";
  }
  const last = lastRequest(branch);
  if (!last) {
    return undefined;
  }
  if (last.type === "compacted") {
    return "cache cold: compacted";
  }
  if (last.provider !== model.provider || last.model !== model.id) {
    return "cache cold: model changed";
  }
  if (last.thinkingLevel !== thinkingLevel) {
    return "cache cold: thinking changed";
  }

  const left = ttl + last.timestamp - now;
  if (left <= 0) {
    return "cache cold: expired";
  } else {
    return `cache warm ${formatDuration(left)}`;
  }
}
