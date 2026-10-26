import type { ConveneIdeResult } from "@t3tools/contracts";
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
  {
    readonly ensure: (
      onProgress?: (progress: NonNullable<ConveneIdeResult["progress"]>) => Effect.Effect<unknown>,
    ) => Effect.Effect<string, CodeServerInstallationError>;
    readonly prepareLanguage: () => Effect.Effect<void, CodeServerInstallationError>;
  }
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

  const prepareLanguage = Effect.fn("CodeServerInstallation.prepareLanguage")(
    function* () {
      const bundle = path.join(directory, "lib", "vscode", "out", "server-main.js");
      const source = yield* fs.readFileString(bundle);
      // 4.141.0's CLI never instantiates the language-pack service, so its install participant
      // misses CLI installs. Rebuild through the native service before serving the first HTML.
      const original = "i.set(Uu,F.createInstance(pl));";
      const updated = original + "await F.invokeFunction(a=>a.get(Uu).update());";
      if (source.includes(updated)) return;
      if (!source.includes(original)) {
        return yield* new CodeServerInstallationError({ code: "install_failed" });
      }
      yield* fs.writeFileString(bundle, source.replace(original, updated));
    },
    Effect.mapError((cause) =>
      isCodeServerInstallationError(cause)
        ? cause
        : new CodeServerInstallationError({ code: "install_failed", cause }),
    ),
  );

  const ensure = Effect.fn("CodeServerInstallation.ensure")(
    function* (onProgress?: Parameters<CodeServerInstallation["Service"]["ensure"]>[0]) {
      if (!supported)
        return yield* new CodeServerInstallationError({ code: "unsupported_platform" });
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
      const length = response.headers["content-length"];
      const encoding = response.headers["content-encoding"];
      const size = length && /^\d+$/.test(length) ? Number(length) : undefined;
      // HTTP clients may decompress the stream, so encoded lengths count different bytes.
      const totalBytes =
        (!encoding || encoding.toLowerCase() === "identity") &&
        size !== undefined &&
        Number.isSafeInteger(size) &&
        size > 0
          ? size
          : undefined;
      let receivedBytes = 0;
      // Chunk reports stay inside the installation span rather than creating a span per chunk.
      const reportDownload = () =>
        onProgress?.({
          stage: "downloading",
          receivedBytes,
          ...(totalBytes === undefined ? {} : { totalBytes }),
        }) ?? Effect.void;
      yield* reportDownload();
      yield* response.stream.pipe(
        Stream.tap((bytes) => {
          receivedBytes += bytes.length;
          return reportDownload();
        }),
        Stream.run(fs.sink(archive)),
      );
      yield* fs.makeDirectory(extracted);
      yield* onProgress?.({ stage: "extracting" }) ?? Effect.void;
      const exit = yield* spawner.exitCode(
        ChildProcess.make("tar", ["-xzf", archive, "-C", extracted, "--strip-components=1"]),
      );
      if (exit !== 0 || !(yield* fs.exists(path.join(extracted, "bin", "code-server")))) {
        return yield* new CodeServerInstallationError({ code: "install_failed" });
      }
      yield* fs.rename(extracted, directory);
      return executable;
    },
    Effect.scoped,
    Effect.timeout("15 minutes"),
    Effect.mapError((cause) =>
      isCodeServerInstallationError(cause)
        ? cause
        : new CodeServerInstallationError({ code: "install_failed", cause }),
    ),
  );
  return CodeServerInstallation.of({ ensure, prepareLanguage });
});

export const layer = Layer.effect(CodeServerInstallation, make);
