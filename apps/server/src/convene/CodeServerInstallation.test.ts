import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import type { ConveneIdeResult } from "@t3tools/contracts";
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

it.live.each(["known", "unknown", "encoded", "invalid"] as const)(
  "reports %s download bytes, unpacks once and reuses without touching user data",
  (length) =>
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
          return HttpClientResponse.fromWeb(
            request,
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(bytes.subarray(0, 7));
                  controller.enqueue(bytes.subarray(7));
                  controller.close();
                },
              }),
              {
                headers:
                  length === "unknown"
                    ? {}
                    : {
                        "content-length":
                          length === "invalid" ? "not-a-length" : String(bytes.length),
                        ...(length === "encoded" ? { "content-encoding": "gzip" } : {}),
                      },
              },
            ),
          );
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
      const progress: Array<NonNullable<ConveneIdeResult["progress"]>> = [];
      const report = (value: NonNullable<ConveneIdeResult["progress"]>) =>
        Effect.sync(() => progress.push(value));
      const first = yield* installation.ensure(report);
      assert.equal(yield* fs.readFileString(first), "#!/bin/sh\nexit 0\n");
      const total = length === "known" ? { totalBytes: bytes.length } : {};
      assert.deepEqual(progress, [
        { stage: "downloading", receivedBytes: 0, ...total },
        { stage: "downloading", receivedBytes: 7, ...total },
        { stage: "downloading", receivedBytes: bytes.length, ...total },
        { stage: "extracting" },
      ]);
      progress.length = 0;
      assert.equal(yield* installation.ensure(report), first);
      assert.deepEqual(progress, []);
      assert.deepEqual(urls, [
        "https://github.com/coder/code-server/releases/download/v4.141.0/code-server-4.141.0-linux-amd64.tar.gz",
      ]);
      assert.equal(yield* fs.readFileString(path.join(data, "keep.txt")), "existing user state");
      assert.ok(
        !(yield* fs.readDirectory(path.dirname(data))).some((entry) =>
          entry.startsWith(".install-"),
        ),
      );
    }).pipe(
      Effect.provide(base),
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provideService(HostProcess.Architecture, "x64"),
    ),
);

it.live("reports extraction failure and removes staging without caching a broken runtime", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const client = HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, new Response("not a tar archive"))),
    );
    const services = yield* Layer.build(
      CodeServerInstallation.layer.pipe(
        Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
      ),
    );
    const installation = Context.get(services, CodeServerInstallation.CodeServerInstallation);
    const progress: Array<NonNullable<ConveneIdeResult["progress"]>> = [];
    const error = yield* installation
      .ensure((value) => Effect.sync(() => progress.push(value)))
      .pipe(Effect.flip);
    assert.equal(error.code, "install_failed");
    assert.deepEqual(progress.at(-1), { stage: "extracting" });
    assert.deepEqual(
      yield* fs.readDirectory(path.join(config.baseDir, "tools", "code-server")),
      [],
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
    assert.equal((yield* installation.ensure().pipe(Effect.flip)).code, "unsupported_platform");
    assert.equal(downloads, 0);
  }).pipe(Effect.provide(base), Effect.provideService(HostProcess.Platform, "win32")),
);

it.effect("leaves an unrecognized native bundle intact when language preparation fails", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const bundle = path.join(
      config.baseDir,
      "tools",
      "code-server",
      CodeServerInstallation.VERSION + "-linux-x64",
      "lib",
      "vscode",
      "out",
      "server-main.js",
    );
    const source = "unexpected native initialization";
    yield* fs.makeDirectory(path.dirname(bundle), { recursive: true });
    yield* fs.writeFileString(bundle, source);
    const services = yield* Layer.build(
      CodeServerInstallation.layer.pipe(
        Layer.provide(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.die("Unexpected download")),
          ),
        ),
      ),
    );
    const installation = Context.get(services, CodeServerInstallation.CodeServerInstallation);
    assert.equal((yield* installation.prepareLanguage().pipe(Effect.flip)).code, "install_failed");
    assert.equal(yield* fs.readFileString(bundle), source);
  }).pipe(
    Effect.provide(base),
    Effect.provideService(HostProcess.Platform, "linux"),
    Effect.provideService(HostProcess.Architecture, "x64"),
  ),
);
