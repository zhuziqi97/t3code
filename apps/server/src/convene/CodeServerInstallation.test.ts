import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ServerConfig from "../config.ts";
import * as CodeServerInstallation from "./CodeServerInstallation.ts";

const base = ServerConfig.layerTest(process.cwd(), { prefix: "t3-code-server-install-" }).pipe(
  Layer.provideMerge(NodeServices.layer),
);

it.live("unpacks a pinned release once and reuses it without touching user data", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const fixture = yield* fs.makeTempDirectoryScoped();
    yield* fs.makeDirectory(path.join(fixture, "release", "bin"), { recursive: true });
    yield* fs.writeFileString(
      path.join(fixture, "release", "bin", "code-server"),
      "#!/bin/sh\nexit 0\n",
    );
    const archive = path.join(fixture, "release.tar.gz");
    assert.equal(
      yield* spawner.exitCode(
        ChildProcess.make("tar", ["-czf", archive, "-C", fixture, "release"]),
      ),
      0,
    );
    const bytes = yield* fs.readFile(archive);
    const urls: string[] = [];
    const client = HttpClient.make((request) =>
      Effect.sync(() => {
        urls.push(request.url);
        return HttpClientResponse.fromWeb(request, new Response(Uint8Array.from(bytes).buffer));
      }),
    );
    const data = path.join(config.baseDir, "tools", "code-server", "data");
    yield* fs.makeDirectory(data, { recursive: true });
    yield* fs.writeFileString(path.join(data, "keep.txt"), "existing user state");
    const services = yield* Layer.build(
      CodeServerInstallation.layer.pipe(
        Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
      ),
    );
    const installation = Context.get(services, CodeServerInstallation.CodeServerInstallation);
    const first = yield* installation.ensure;
    assert.equal(yield* fs.readFileString(first), "#!/bin/sh\nexit 0\n");
    assert.equal(yield* installation.ensure, first);
    assert.deepEqual(urls, [
      "https://github.com/coder/code-server/releases/download/v4.141.0/code-server-4.141.0-linux-amd64.tar.gz",
    ]);
    assert.equal(yield* fs.readFileString(path.join(data, "keep.txt")), "existing user state");
    assert.ok(
      !(yield* fs.readDirectory(path.dirname(data))).some((entry) => entry.startsWith(".install-")),
    );
  }).pipe(
    Effect.provide(base),
    Effect.provideService(HostProcess.Platform, "linux"),
    Effect.provideService(HostProcess.Architecture, "x64"),
  ),
);

it.effect("does not download or create a runtime on unsupported Windows hosts", () =>
  Effect.gen(function* () {
    let downloads = 0;
    const client = HttpClient.make(() =>
      Effect.sync(() => {
        downloads++;
        throw new Error("Unexpected download");
      }),
    );
    const services = yield* Layer.build(
      CodeServerInstallation.layer.pipe(
        Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
      ),
    );
    const installation = Context.get(services, CodeServerInstallation.CodeServerInstallation);
    assert.equal((yield* installation.ensure.pipe(Effect.flip)).code, "unsupported_platform");
    assert.equal(downloads, 0);
  }).pipe(Effect.provide(base), Effect.provideService(HostProcess.Platform, "win32")),
);
