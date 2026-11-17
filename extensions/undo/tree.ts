import { sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import type {
  SessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

type Session = Pick<SessionManager, "getEntries" | "getBranch">;

// Whether `entry` is model-visible rather than state-only, like a label, a
// model change, or extension data, as pi decides:
// https://github.com/earendil-works/pi/blob/b4afdddf44e059c67ccf5097e5317d913521b470/packages/coding-agent/src/core/session-manager.ts#L439
function isModelVisible(entry: SessionEntry) {
  return sessionEntryToContextMessages(entry).length > 0;
}

// The entries below `entry` (undefined for the root), in the order they were
// added. One pass suffices, as a parent is always added before its children.
function below(entries: SessionEntry[], entry?: SessionEntry) {
  const ids = new Set([entry?.id ?? null]);
  return entries.filter((e) => {
    if (!ids.has(e.parentId)) return false;
    ids.add(e.id);
    return true;
  });
}

function isUser(e: SessionEntry) {
  return e.type === "message" && e.message.role === "user";
}

// The entry /undo navigates to: the last user message on the branch.
export function undoTarget(session: Session) {
  return session.getBranch().findLast(isUser)?.id;
}

// The entry /redo navigates to, walking down from the end of the branch.
export function redoTarget(session: Session) {
  const branch = session.getBranch();
  const start = branch.findLast(isModelVisible);
  const rest = below(session.getEntries(), start);
  const latest = rest.findLast(isModelVisible);
  if (!latest) return;
  const depth = start ? branch.indexOf(start) + 1 : 0;
  const path = session.getBranch(latest.id).slice(depth);
  const target = path.filter(isModelVisible).slice(1).find(isUser) ?? latest;
  return target.id;
}
