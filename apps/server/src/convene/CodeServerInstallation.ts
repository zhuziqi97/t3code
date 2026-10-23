import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ServerConfig from "../config.ts";

export const VERSION = "4.141.0";

export class CodeServerInstallationError extends Schema.TaggedError<CodeServerInstallationError>()(
  "CodeServerInstallationError",
  {
    code: Schema.Literals(["unsupported_platform", "install_failed"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.code === "unsupported_platform"
      ? "Code-server is not supported on this environment's operating system or architecture."
      : "Could not install code-server in this environment.";
  }
}

export class CodeServerInstallation extends Context.Service<
  CodeServerInstallation,
  { readonly ensure: Effect.Effect<string, CodeServerInstallationError> }
>()("t3/convene/CodeServerInstallation") {}

export const isCodeServerInstallationError = Schema.is(CodeServerInstallationError);

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const platform = yield* HostProcess.Platform;
  const arch = yield* HostProcess.Architecture;
  const supported =
    (platform === "linux" || platform === "darwin") && (arch === "x64" || arch === "arm64");
  const asset = `code-server-${VERSION}-${platform === "darwin" ? "macos" : platform}-${arch === "x64" ? "amd64" : arch}.tar.gz`;
  const directory = path.join(
    config.baseDir,
    "tools",
    "code-server",
    `${VERSION}-${platform}-${arch}`,
  );
  const executable = path.join(directory, "bin", "code-server");

  const ensure = Effect.gen(function* () {
    if (!supported) return yield* new CodeServerInstallationError({ code: "unsupported_platform" });
    if (yield* fs.exists(executable)) return executable;
    yield* fs.makeDirectory(path.dirname(directory), { recursive: true });
    const staging = yield* fs.makeTempDirectoryScoped({
      directory: path.dirname(directory),
      prefix: ".install-",
    });
    const archive = path.join(staging, "download.tar.gz");
    const extracted = path.join(staging, "runtime");
    const response = yield* http
      .execute(
        HttpClientRequest.get(
          `https://github.com/coder/code-server/releases/download/v${VERSION}/${asset}`,
        ),
      )
      .pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
    yield* Stream.run(response.stream, fs.sink(archive));
    yield* fs.makeDirectory(extracted);
    const exit = yield* spawner.exitCode(
      ChildProcess.make("tar", ["-xzf", archive, "-C", extracted, "--strip-components=1"]),
    );
    if (exit !== 0 || !(yield* fs.exists(path.join(extracted, "bin", "code-server")))) {
      return yield* new CodeServerInstallationError({ code: "install_failed" });
    }
    yield* fs.rename(extracted, directory);
    return executable;
  }).pipe(
    Effect.scoped,
    Effect.timeout("15 minutes"),
    Effect.mapError((cause) =>
      isCodeServerInstallationError(cause)
        ? cause
        : new CodeServerInstallationError({ code: "install_failed", cause }),
    ),
    Effect.withSpan("CodeServerInstallation.ensure"),
  );
  return CodeServerInstallation.of({ ensure });
});

export const layer = Layer.effect(CodeServerInstallation, make);
