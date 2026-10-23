import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EventId, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as Git from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as ConveneWorkspaces from "./ConveneWorkspaces.ts";

const layer = ConveneWorkspaces.layer.pipe(
  Layer.provideMerge(ProjectStore.layer.pipe(Layer.provide(SqlitePersistence.layerMemory))),
  Layer.provideMerge(Git.layer.pipe(Layer.provide(VcsProcess.layer))),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-convene-workspaces-" })),
  Layer.provideMerge(NodeServices.layer),
);

it.effect(
  "keeps subdirectory projects and pins old threads when a worktree is removed and recreated",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const git = yield* Git.GitVcsDriver;
      const projects = yield* ProjectStore.ProjectStoreV2;
      const workspaces = yield* ConveneWorkspaces.ConveneWorkspaces;
      const parent = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-convene-worktree-repository-",
      });
      const repository = `${parent}/repository`;
      const checkout = `${parent}/checkout`;
      yield* fs.makeDirectory(`${repository}/src`, { recursive: true });
      yield* fs.writeFileString(`${repository}/src/file.txt`, "workspace content");
      const run = (args: string[]) =>
        git.execute({ operation: "ConveneWorkspaces.test", cwd: repository, args });
      yield* run(["init"]);
      yield* run(["add", "."]);
      yield* run([
        "-c",
        "user.name=Convene Test",
        "-c",
        "user.email=convene-test@example.invalid",
        "commit",
        "-m",
        "initial",
      ]);
      yield* run(["worktree", "add", "--detach", checkout, "HEAD"]);
      const projectId = ProjectId.make("convene:subdirectory");
      yield* projects.apply({
        sequence: 1,
        eventId: EventId.make("project:workspace-test"),
        aggregateKind: "project",
        aggregateId: projectId,
        type: "project.created",
        occurredAt: "2026-10-09T00:00:00Z",
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        payload: {
          projectId,
          title: "Subdirectory",
          workspaceRoot: `${repository}/src`,
          defaultModelSelection: null,
          scripts: [],
          createdAt: "2026-10-09T00:00:00Z",
          updatedAt: "2026-10-09T00:00:00Z",
        },
      });
      const initial = yield* workspaces.list(projectId);
      assert.equal(
        initial.find((workspace) => workspace.key === "root")?.path,
        `${repository}/src`,
      );
      const linked = initial.find((workspace) => workspace.key !== "root");
      assert.ok(linked);
      assert.equal(linked.path, `${checkout}/src`);
      assert.equal(linked.available, true);
      assert.equal((yield* workspaces.resolve(projectId, linked.key))?.key, linked.key);
      yield* workspaces.rememberThread(projectId, "original-thread", linked.key);
      yield* workspaces.rememberThread(projectId, "other-thread", linked.key);
      yield* run(["worktree", "remove", "--force", checkout]);
      assert.equal((yield* workspaces.resolve(projectId, linked.key))?.available, false);
      assert.equal(yield* workspaces.resolve(projectId, "unknown-workspace"), null);
      yield* run(["worktree", "add", "--detach", checkout, "HEAD"]);
      const next = yield* workspaces.list(projectId);
      const replacement = next.find((workspace) => workspace.key !== "root" && workspace.available);
      assert.ok(replacement);
      assert.notEqual(replacement.key, linked.key);
      assert.equal(next.find((workspace) => workspace.key === linked.key)?.available, false);
      assert.equal(yield* workspaces.threadKey(projectId, "original-thread"), linked.key);
      // A second association cannot move a durable native thread to the replacement.
      yield* workspaces.rememberThread(projectId, "original-thread", replacement.key);
      assert.equal(yield* workspaces.threadKey(projectId, "original-thread"), linked.key);
      const cachePath = `${(yield* ServerConfig.ServerConfig).stateDir}/convene-workspaces.json`;
      yield* fs.rename(cachePath, `${cachePath}.saved`);
      yield* fs.makeDirectory(cachePath);
      assert.equal(
        (yield* workspaces
          .rebindThread(projectId, "original-thread", replacement.key)
          .pipe(Effect.flip))._tag,
        "ConveneWorkspaceError",
      );
      assert.equal(yield* workspaces.threadKey(projectId, "original-thread"), linked.key);
      assert.equal(yield* workspaces.threadKey(projectId, "other-thread"), linked.key);
      yield* fs.remove(cachePath, { recursive: true });
      yield* fs.rename(`${cachePath}.saved`, cachePath);
      yield* workspaces.rebindThread(projectId, "original-thread", replacement.key);
      assert.equal(yield* workspaces.threadKey(projectId, "original-thread"), replacement.key);
      assert.equal(yield* workspaces.threadKey(projectId, "other-thread"), linked.key);
      const saved = yield* Effect.gen(function* () {
        const restarted = yield* ConveneWorkspaces.ConveneWorkspaces;
        return [
          yield* restarted.threadKey(projectId, "original-thread"),
          yield* restarted.threadKey(projectId, "other-thread"),
        ];
      }).pipe(Effect.provide(Layer.fresh(ConveneWorkspaces.layer)));
      assert.deepEqual(saved, [replacement.key, linked.key]);
    }).pipe(Effect.provide(layer)),
);

it.effect(
  "reports an ordinary folder without inventing a Git repository or a fallback directory",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const projects = yield* ProjectStore.ProjectStoreV2;
      const workspaces = yield* ConveneWorkspaces.ConveneWorkspaces;
      const parent = yield* fs.makeTempDirectoryScoped({ prefix: "t3-convene-plain-folder-" });
      const root = `${parent}/project`;
      yield* fs.makeDirectory(root);
      const projectId = ProjectId.make("convene:plain");
      yield* projects.apply({
        sequence: 1,
        eventId: EventId.make("project:plain-test"),
        aggregateKind: "project",
        aggregateId: projectId,
        type: "project.created",
        occurredAt: "2026-10-09T00:00:00Z",
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        payload: {
          projectId,
          title: "Plain",
          workspaceRoot: root,
          defaultModelSelection: null,
          scripts: [],
          createdAt: "2026-10-09T00:00:00Z",
          updatedAt: "2026-10-09T00:00:00Z",
        },
      });
      const initial = yield* workspaces.list(projectId);
      assert.equal(initial.length, 1);
      assert.equal(initial[0]?.path, root);
      yield* fs.remove(root, { recursive: true });
      assert.equal((yield* workspaces.resolve(projectId, "root"))?.available, false);
      yield* fs.makeDirectory(root);
      assert.equal((yield* workspaces.resolve(projectId, "root"))?.available, true);
    }).pipe(Effect.provide(layer)),
);
