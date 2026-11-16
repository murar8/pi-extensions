import type {
  CustomEntry,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

export const UNDO_ENTRY_CUSTOM_TYPE = "undo-v2";

// A snapshot of the files, holding their tree hash.
function isSnapshot(entry?: SessionEntry): entry is CustomEntry<string> {
  return (
    entry?.type === "custom" && entry.customType === UNDO_ENTRY_CUSTOM_TYPE
  );
}

// Whether snapshotting `tree` at `leaf` would repeat the snapshot there. Only
// an identical parent is safe to skip, as every lookup sees it.
export function repeats(leaf: SessionEntry | undefined, tree: string) {
  return isSnapshot(leaf) && leaf.data === tree;
}

// Whether /tree opens `entry` in the editor, moving the leaf to its parent, as
// pi does:
// https://github.com/earendil-works/pi/blob/b4afdddf44e059c67ccf5097e5317d913521b470/packages/coding-agent/src/core/agent-session.ts#L4255
function opensInEditor(entry?: SessionEntry) {
  const user = entry?.type === "message" && entry.message.role === "user";
  const custom = entry?.type === "custom_message";
  return user || custom;
}

// The children of `parentId`, as pi's getChildren, which extensions can't call:
// https://github.com/earendil-works/pi/blob/b4afdddf44e059c67ccf5097e5317d913521b470/packages/coding-agent/src/core/session-manager.ts#L1430
function getChildren(entries: SessionEntry[], parentId: string) {
  return entries.filter((e) => e.parentId === parentId);
}

// The entries below `parentId` on every branch, down to the next messages.
function entriesBelow(
  entries: SessionEntry[],
  parentId: string,
): SessionEntry[] {
  return getChildren(entries, parentId)
    .filter((e) => e.type !== "message")
    .flatMap((e) => [e, ...entriesBelow(entries, e.id)]);
}

// The tree of the latest snapshot at the message `id`, on every branch.
function latestAt(entries: SessionEntry[], id: string) {
  const below = new Set(entriesBelow(entries, id));
  return entries.filter(isSnapshot).findLast((e) => below.has(e))?.data;
}

// The tree to restore at the end of `branch`: where you last left off at a
// message, or else the files as of the entry.
export function findTree(entries: SessionEntry[], branch: SessionEntry[]) {
  if (opensInEditor(branch.at(-1))) branch = branch.slice(0, -1);
  const target = branch.at(-1);
  const at =
    target?.type === "message" ? latestAt(entries, target.id) : undefined;
  return at ?? branch.findLast(isSnapshot)?.data;
}
