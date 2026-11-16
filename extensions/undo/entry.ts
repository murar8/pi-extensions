import type {
  CustomEntry,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

export const UNDO_ENTRY_CUSTOM_TYPE = "undo";

// A snapshot of the files at message `at`, the last one before it.
function isSnapshot(
  entry: SessionEntry,
): entry is CustomEntry<{ tree: string; at?: string }> {
  return entry.type === "custom" && entry.customType === UNDO_ENTRY_CUSTOM_TYPE;
}

function lastMessageId(entries: SessionEntry[]) {
  return entries.findLast(({ type }) => type === "message")?.id;
}

// Whether /tree opens `entry` in the editor, moving the leaf to its parent, as
// pi does:
// https://github.com/earendil-works/pi/blob/b4afdddf44e059c67ccf5097e5317d913521b470/packages/coding-agent/src/core/agent-session.ts#L4255
function opensInEditor(entry: SessionEntry | undefined) {
  const user = entry?.type === "message" && entry.message.role === "user";
  const custom = entry?.type === "custom_message";
  return user || custom;
}

// Finds the latest snapshot at message `at`.
function findSnapshotAt(entries: SessionEntry[], at: string | undefined) {
  if (!at) return;
  return entries.filter(isSnapshot).findLast(({ data }) => data?.at === at);
}

// Finds the latest snapshot at the /tree target, falling back to the last one
// before it.
export function findSnapshot(branch: SessionEntry[], entries: SessionEntry[]) {
  branch = opensInEditor(branch.at(-1)) ? branch.slice(0, -1) : branch;
  const last = branch.findLast(isSnapshot);
  // A selected snapshot is the exact state there.
  if (last === branch.at(-1)) return last?.data?.tree;
  const at = lastMessageId(branch);
  const snapshot = findSnapshotAt(entries, at) ?? last;
  return snapshot?.data?.tree;
}

export function snapshotData(branch: SessionEntry[], tree: string) {
  const last = branch.at(-1);
  // Skips repeating the leaf, as before_agent_start does after turn_end.
  if (last && isSnapshot(last) && last.data?.tree === tree) return;
  return { tree, at: lastMessageId(branch) };
}
