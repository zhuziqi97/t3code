import type { ConveneResourceReadResult, ScopedThreadRef } from "@t3tools/contracts";
import {
  createConveneResourceReader,
  conveneResourceTransportFailure,
  type ConveneResourceReaderState,
} from "@t3tools/client-runtime/convene-resource-reader";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Atom, AsyncResult } from "effect/reactivity";
import { create } from "zustand";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { conveneEnvironment } from "../../state/convene";
import { environmentPresentations } from "../../state/presentation";
import { useRightPanelStore, type ConveneResourceSurface } from "../../rightPanelStore";

export interface ConveneResourceAccess {
  status: "ready" | "loading" | "unauthorized" | "disconnected" | "unavailable";
  revision: number | null;
}
interface ResourceSession {
  state: ConveneResourceReaderState;
  access: ConveneResourceAccess;
  scrollTop: number;
}
interface ResourceStore {
  sessions: Record<string, ResourceSession>;
  retain: (target: ConveneResourceSurface) => void;
  release: (id: string) => void;
  load: (id: string, page?: number, startLine?: number) => Promise<void>;
  setScroll: (id: string, top: number) => void;
}

export function createConveneResourceStore(
  read: (
    target: ConveneResourceSurface,
    page: number,
    startLine?: number,
  ) => Promise<ConveneResourceReadResult>,
  observe: (ref: ScopedThreadRef, changed: (access: ConveneResourceAccess) => void) => () => void,
) {
  const readers = new Map<
    string,
    {
      reader: ReturnType<typeof createConveneResourceReader>;
      requested: boolean;
      uri: string;
      stop: () => void;
    }
  >();
  return create<ResourceStore>()((set, get) => ({
    sessions: {},
    retain: (target) => {
      const id = target.id;
      if (readers.has(id)) return;
      const entry = {
        reader: createConveneResourceReader(
          (_uri, page, line) => read(target, page, line),
          (state) => {
            if (readers.get(id) !== entry) return;
            set((s) => ({
              sessions: {
                ...s.sessions,
                [id]: { ...s.sessions[id]!, state: { ...state, uri: target.uri } },
              },
            }));
          },
        ),
        requested: false,
        uri: target.uri,
        stop: () => {},
      };
      readers.set(id, entry);
      set((s) => ({
        sessions: {
          ...s.sessions,
          [id]: {
            state: { uri: target.uri, result: null, pending: false, needsRefresh: false },
            access: { status: "loading", revision: null },
            scrollTop: 0,
          },
        },
      }));
      entry.stop = observe(target.sourceThreadRef, (access) => {
        const current = get().sessions[id];
        if (
          readers.get(id) !== entry ||
          !current ||
          (current.access.status === access.status && current.access.revision === access.revision)
        )
          return;
        entry.reader.clear();
        set((s) => ({
          sessions: { ...s.sessions, [id]: { ...s.sessions[id]!, access, scrollTop: 0 } },
        }));
        if (access.status === "ready" && entry.requested) void get().load(id);
      });
    },
    release: (id) => {
      const entry = readers.get(id);
      if (!entry) return;
      readers.delete(id);
      entry.stop();
      entry.reader.clear();
      set((s) => {
        const { [id]: _removed, ...sessions } = s.sessions;
        return { sessions };
      });
    },
    load: async (id, page = 1, line) => {
      const entry = readers.get(id);
      const session = get().sessions[id];
      if (!entry || !session) return;
      entry.requested = true;
      if (session.access.status === "ready") await entry.reader.load(entry.uri, page, line);
    },
    setScroll: (id, scrollTop) =>
      set((s) =>
        s.sessions[id] && s.sessions[id].scrollTop !== scrollTop
          ? { sessions: { ...s.sessions, [id]: { ...s.sessions[id], scrollTop } } }
          : s,
      ),
  }));
}

export const useConveneResourceStore = createConveneResourceStore(
  async (target, page, startLine) => {
    const response = await runAtomCommand(
      appAtomRegistry,
      conveneEnvironment.readResource,
      {
        environmentId: target.sourceThreadRef.environmentId,
        input: {
          threadId: target.sourceThreadRef.threadId,
          uri: target.uri,
          page,
          ...(startLine === undefined ? {} : { startLine }),
        },
      },
      { reportFailure: false },
    );
    return response._tag === "Success"
      ? response.value
      : conveneResourceTransportFailure(target.uri, squashAtomCommandFailure(response));
  },
  (ref, changed) => {
    const atom = Atom.make((get) => {
      const connected =
        get(environmentPresentations.presentationAtom(ref.environmentId))?.connection.phase ===
        "connected";
      const permitted = get(conveneEnvironment.readResource.permissionAtom(ref.environmentId));
      const connection = get(
        conveneEnvironment.status({ environmentId: ref.environmentId, input: {} }),
      );
      const changes = get(
        conveneEnvironment.resourceChanges({
          environmentId: ref.environmentId,
          input: { threadId: ref.threadId },
        }),
      );
      const phase = AsyncResult.isSuccess(connection) ? connection.value.phase : null;
      const status: ConveneResourceAccess["status"] = !connected
        ? "disconnected"
        : !permitted
          ? "unauthorized"
          : phase === "offline" || phase === "unpaired"
            ? "disconnected"
            : phase === "online"
              ? "ready"
              : AsyncResult.isFailure(connection)
                ? "unavailable"
                : "loading";
      return { status, revision: AsyncResult.isSuccess(changes) ? changes.value : null };
    });
    return appAtomRegistry.subscribe(atom, changed, { immediate: true });
  },
);

function synchronizeResourceSessions() {
  const store = useConveneResourceStore.getState();
  const open = new Set<string>();
  for (const panel of Object.values(useRightPanelStore.getState().byThreadKey)) {
    for (const surface of panel.surfaces)
      if (surface.kind === "convene-resource") {
        open.add(surface.id);
        store.retain(surface);
      }
  }
  for (const id of Object.keys(store.sessions)) if (!open.has(id)) store.release(id);
}
useRightPanelStore.subscribe((next, previous) => {
  if (next.byThreadKey !== previous.byThreadKey) synchronizeResourceSessions();
});
synchronizeResourceSessions();
