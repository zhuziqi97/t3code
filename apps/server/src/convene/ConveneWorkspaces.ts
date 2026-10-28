import { type ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as Git from "../vcs/GitVcsDriver.ts";

export const Workspace = Schema.Struct({
  projectId: Schema.String,
  key: Schema.String,
  path: Schema.String,
  displayName: Schema.String,
  branch: Schema.NullOr(Schema.String),
  available: Schema.Boolean,
});
export type Workspace = typeof Workspace.Type;
const ThreadWorkspace = Schema.Struct({
  projectId: Schema.String,
  threadId: Schema.String,
  key: Schema.String,
});
const State = Schema.Struct({
  workspaces: Schema.Array(Workspace),
  threads: Schema.Array(ThreadWorkspace),
});
const decodeState = Schema.decodeUnknownEffect(Schema.fromJsonString(State));
const encodeState = Schema.encodeEffect(Schema.fromJsonString(State));

export class ConveneWorkspaceError extends Schema.TaggedError<ConveneWorkspaceError>()(
  "ConveneWorkspaceError",
  { projectId: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return "Could not read the project's Convene workspaces.";
  }
}

export class ConveneWorkspaces extends Context.Service<
  ConveneWorkspaces,
  {
    readonly changes: Stream.Stream<void>;
    readonly list: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<Workspace>, ConveneWorkspaceError>;
    readonly resolve: (
      projectId: ProjectId,
      key: string,
    ) => Effect.Effect<Workspace | null, ConveneWorkspaceError>;
    readonly rememberThread: (
      projectId: ProjectId,
      threadId: string,
      key: string,
    ) => Effect.Effect<void, ConveneWorkspaceError>;
    readonly rebindThread: (
      projectId: ProjectId,
      threadId: string,
      key: string,
    ) => Effect.Effect<void, ConveneWorkspaceError>;
    readonly threadKey: (projectId: ProjectId, threadId: string) => Effect.Effect<string | null>;
  }
>()("t3/convene/ConveneWorkspaces") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const config = yield* ServerConfig.ServerConfig;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const git = yield* Git.GitVcsDriver;
  const lock = yield* Semaphore.make(1);
  const changes = yield* PubSub.unbounded<void>();
  const cachePath = path.join(config.stateDir, "convene-workspaces.json");
  const cache = (yield* fs.exists(cachePath))
    ? yield* fs.readFileString(cachePath).pipe(Effect.flatMap(decodeState))
    : { workspaces: [], threads: [] };
  const entries = new Map(
    cache.workspaces.map((entry) => [`${entry.projectId}:${entry.key}`, entry]),
  );
  const threadKeys = new Map(
    cache.threads.map((entry) => [`${entry.projectId}:${entry.threadId}`, entry]),
  );
  let savedJson = yield* encodeState(cache);
  const persist = Effect.gen(function* () {
    const json = yield* encodeState({
      workspaces: [...entries.values()],
      threads: [...threadKeys.values()],
    });
    if (savedJson !== json) {
      yield* fs.writeFileString(cachePath, json);
      savedJson = json;
    }
  });
  const directoryExists = (directory: string) =>
    fs.stat(directory).pipe(
      Effect.map((stat) => stat.type === "Directory"),
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound" ? Effect.succeed(false) : Effect.fail(error),
      }),
    );
  const command = (cwd: string, args: ReadonlyArray<string>) =>
    git.execute({ operation: "convene-workspaces", cwd, args });

  const list = Effect.fn("ConveneWorkspaces.list")(function* (projectId: ProjectId) {
    return yield* lock
      .withPermit(
        Effect.gen(function* () {
          const project = yield* projects.get(projectId);
          if (project._tag === "None") return [];
          const root = project.value.workspaceRoot;
          const available = yield* directoryExists(root);
          for (const [id, entry] of entries) {
            if (entry.projectId === projectId) entries.set(id, { ...entry, available: false });
          }
          const set = (entry: Workspace) => entries.set(`${projectId}:${entry.key}`, entry);
          set({
            projectId,
            key: "root",
            path: root,
            displayName: "Project folder",
            branch: null,
            available,
          });
          if (available) {
            const repository = yield* git.execute({
              operation: "convene-workspaces.detect",
              cwd: root,
              args: ["rev-parse", "--show-toplevel"],
              allowNonZeroExit: true,
            });
            if (repository.exitCode === 0) {
              const repositoryRoot = repository.stdout.trim();
              const rootBranch = yield* git.execute({
                operation: "convene-workspaces.branch",
                cwd: root,
                args: ["symbolic-ref", "--short", "-q", "HEAD"],
                allowNonZeroExit: true,
              });
              set({
                projectId,
                key: "root",
                path: root,
                displayName: "Project folder",
                branch: rootBranch.exitCode === 0 ? rootBranch.stdout.trim() : null,
                available,
              });
              const relative = path.relative(repositoryRoot, root);
              for (const checkout of yield* git.listWorktreePaths(root)) {
                const workspacePath = path.join(checkout, relative);
                if (workspacePath === root) continue;
                if (!(yield* directoryExists(checkout))) continue;
                // Git removes a linked checkout's admin directory on removal. A
                // new checkout at the same path consequently receives a new id.
                const admin = (yield* command(checkout, [
                  "rev-parse",
                  "--absolute-git-dir",
                ])).stdout.trim();
                const marker = path.join(admin, "t3-convene-workspace-id");
                const key = (yield* fs.exists(marker))
                  ? (yield* fs.readFileString(marker)).trim()
                  : yield* crypto
                      .randomUUIDv4()
                      .pipe(Effect.tap((id) => fs.writeFileString(marker, id)));
                const branch = (yield* command(checkout, [
                  "rev-parse",
                  "--abbrev-ref",
                  "HEAD",
                ])).stdout.trim();
                set({
                  projectId,
                  key,
                  path: workspacePath,
                  displayName: path.basename(checkout),
                  branch: branch === "HEAD" ? null : branch,
                  available: yield* directoryExists(workspacePath),
                });
              }
            }
          }
          const next = [...entries.values()];
          yield* persist;
          return next.filter((entry) => entry.projectId === projectId);
        }),
      )
      .pipe(Effect.mapError((cause) => new ConveneWorkspaceError({ projectId, cause })));
  });
  return ConveneWorkspaces.of({
    changes: Stream.fromPubSub(changes),
    list,
    resolve: Effect.fn("ConveneWorkspaces.resolve")((projectId, key) =>
      list(projectId).pipe(Effect.map((items) => items.find((item) => item.key === key) ?? null)),
    ),
    threadKey: Effect.fn("ConveneWorkspaces.threadKey")((projectId, threadId) =>
      Effect.sync(() => threadKeys.get(`${projectId}:${threadId}`)?.key ?? null),
    ),
    rebindThread: Effect.fn("ConveneWorkspaces.rebindThread")(function* (projectId, threadId, key) {
      const target = (yield* list(projectId)).find((workspace) => workspace.key === key);
      if (!target?.available) return yield* new ConveneWorkspaceError({ projectId });
      yield* lock
        .withPermit(
          Effect.gen(function* () {
            const id = `${projectId}:${threadId}`;
            const previous = threadKeys.get(id);
            if (previous?.key === key) return yield* persist;
            threadKeys.set(id, { projectId, threadId, key });
            yield* persist.pipe(
              Effect.onError(() =>
                Effect.sync(() => {
                  if (previous === undefined) threadKeys.delete(id);
                  else threadKeys.set(id, previous);
                }),
              ),
            );
            yield* PubSub.publish(changes, undefined);
          }),
        )
        .pipe(Effect.mapError((cause) => new ConveneWorkspaceError({ projectId, cause })));
    }),
    rememberThread: Effect.fn("ConveneWorkspaces.rememberThread")((projectId, threadId, key) =>
      lock
        .withPermit(
          Effect.gen(function* () {
            const id = `${projectId}:${threadId}`;
            if (threadKeys.has(id)) return yield* persist;
            threadKeys.set(id, { projectId, threadId, key });
            yield* persist;
          }),
        )
        .pipe(Effect.mapError((cause) => new ConveneWorkspaceError({ projectId, cause }))),
    ),
  });
});

export const layer = Layer.effect(ConveneWorkspaces, make);
