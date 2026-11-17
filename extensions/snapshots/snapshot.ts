import type {
  CustomEntry,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

export const ENTRY_CUSTOM_TYPE = "snapshots-v1";

// A snapshot of the files, holding their tree hash.
function isSnapshot(entry?: SessionEntry): entry is CustomEntry<string> {
  return entry?.type === "custom" && entry.customType === ENTRY_CUSTOM_TYPE;
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

// The tree of the first snapshot after `id`, down to the next message. Follows
// the first child, the branch that came first, so later visits don't count.
function firstAfter(entries: SessionEntry[], id: string): string | undefined {
  const child = entries.find((e) => e.parentId === id);
  if (!child || child.type === "message") return undefined;
  return isSnapshot(child) ? child.data : firstAfter(entries, child.id);
}

// The tree to restore at the end of `branch`: the files right after a message,
// or else the files as of the entry.
export function findTree(entries: SessionEntry[], branch: SessionEntry[]) {
  if (opensInEditor(branch.at(-1))) branch = branch.slice(0, -1);
  const target = branch.at(-1);
  const after =
    target?.type === "message" ? firstAfter(entries, target.id) : undefined;
  return after ?? branch.findLast(isSnapshot)?.data;
}
