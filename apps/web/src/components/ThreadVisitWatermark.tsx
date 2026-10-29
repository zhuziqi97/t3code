import { useAtomMount } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { createThreadVisitTracker } from "@t3tools/client-runtime/state/thread-visits";
import { type ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { getDocumentActivity, subscribeDocumentActivity } from "../lib/documentActivity";
import { useUiStateStore } from "../uiStateStore";
import { environmentThreadShells, threadEnvironment } from "../state/threads";

const documentActivityAtom = Atom.make((get) => {
  get.addFinalizer(subscribeDocumentActivity(() => get.setSelf(getDocumentActivity())));
  return getDocumentActivity();
});

const threadVisitTracker = createThreadVisitTracker({
  threadShellAtom: (ref) =>
    Atom.make((get) => {
      const activity = get(documentActivityAtom);
      return activity.visible && activity.focused
        ? get(environmentThreadShells.threadShellAtom(ref))
        : null;
    }),
  visit: threadEnvironment.visit,
  markLocalVisit: (ref, visitedAt) =>
    useUiStateStore.getState().markThreadVisited(scopedThreadKey(ref), visitedAt),
});

// The visit watermark is the one part of the chat view that follows the
// shell's updatedAt, which ticks while a run streams. The tracker subscribes to
// it outside React, so ChatView keeps reading the quiet shell.
export function ThreadVisitWatermark(props: { readonly threadRef: ScopedThreadRef }) {
  useAtomMount(threadVisitTracker(props.threadRef));
  return null;
}
