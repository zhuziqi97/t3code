import type { ConveneDesktopUpdate, DesktopUpdateState } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopTelemetryPublisher from "../telemetry/DesktopTelemetryPublisher.ts";
import * as IpcChannels from "../ipc/channels.ts";
import type { DesktopUpdates } from "./DesktopUpdates.ts";
import { createInitialDesktopUpdateState } from "./updateMachine.ts";
import { ConveneRelease, conveneUrl, resolveConveneRelease } from "./conveneRelease.ts";

const CONNECT_FIRST = "Connect the desktop primary environment to Convene to check for updates.";
const MANUAL_INSTALL =
  "Download the package from your Convene platform and install it when you are ready.";
const CHECK_FAILED = "Could not check the Convene release. Please try again.";
const NO_PACKAGE =
  "This release has no matching package for this installation. Open your platform downloads for details.";
const CurrentBuild = Schema.Struct({ build_id: Schema.NonEmptyString });

function releaseMessage(release: ConveneDesktopUpdate) {
  const available = release.relation === "newer" || release.relation === "different-build";
  if (available && release.downloadUrl === null) return NO_PACKAGE;
  if (release.relation === "different-build")
    return "Your platform offers a different build of the same version.";
  if (release.relation === "older")
    return "Your platform offers an older version than this installation.";
  if (release.relation === "unknown-build")
    return "The local build identity is unavailable. Check your platform downloads.";
  return available ? MANUAL_INSTALL : null;
}

/** The platform release transport for the existing DesktopUpdates owner. */
export const make = Effect.gen(function* () {
  const config = yield* DesktopConfig.DesktopConfig;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const publisher = yield* DesktopTelemetryPublisher.DesktopTelemetryPublisher;
  const window = yield* ElectronWindow.ElectronWindow;
  const shell = yield* ElectronShell.ElectronShell;
  const fs = yield* FileSystem.FileSystem;
  const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const buildId = yield* fs
    .readFileString(environment.path.join(environment.clientAssetsDir, "convene-build.json"))
    .pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(CurrentBuild))),
      Effect.map((info) => info.build_id),
      Effect.orElseSucceed(() => null),
    );
  const packageType = yield* fs
    .readFileString(environment.path.join(environment.resourcesPath, "package-type"))
    .pipe(
      Effect.map((value) => value.trim()),
      Effect.orElseSucceed(() => null),
    );
  const emptySource = (baseUrl: string | null): ConveneDesktopUpdate => ({
    baseUrl,
    currentBuildId: buildId,
    releaseVersion: null,
    releaseBuildId: null,
    relation: null,
    downloadUrl: null,
    downloadsUrl: baseUrl ? conveneUrl(baseUrl, "downloads/latest") : null,
    helpUrl: baseUrl ? conveneUrl(baseUrl, "help/t3code") : null,
  });
  const initial = (): DesktopUpdateState => ({
    ...createInitialDesktopUpdateState(environment.appVersion, environment.runtimeInfo, "latest"),
    enabled: !config.disableAutoUpdate,
    status: config.disableAutoUpdate ? "disabled" : "idle",
    message: config.disableAutoUpdate
      ? "Automatic updates are disabled by the T3CODE_DISABLE_AUTO_UPDATE setting."
      : CONNECT_FIRST,
    convene: emptySource(null),
  });
  const state = yield* Ref.make(initial());
  const changes = yield* PubSub.sliding<DesktopUpdateState>(16);
  const mutex = yield* Semaphore.make(1);
  let baseUrl: string | null = null;
  let generation = 0;
  let checking: number | undefined;
  let configured = false;
  const setState = (next: DesktopUpdateState) =>
    mutex
      .withPermits(1)(Ref.set(state, next).pipe(Effect.andThen(PubSub.publish(changes, next))))
      .pipe(Effect.andThen(window.sendAll(IpcChannels.UPDATE_STATE_CHANNEL, next)));
  const getState = Ref.get(state);
  const checkedAt = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const check = Effect.fn("ConveneReleaseUpdates.check")(function* (_reason: string) {
    if (baseUrl === null || config.disableAutoUpdate || checking === generation) {
      return { checked: false, state: yield* getState };
    }
    const source = baseUrl;
    const epoch = generation;
    checking = epoch;
    const previous = yield* getState;
    yield* setState({ ...previous, status: "checking", message: null, errorContext: null });
    const result = yield* http.get(conveneUrl(source, "downloads/release.json")).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(ConveneRelease)),
      Effect.flatMap((release) =>
        Effect.try(() =>
          resolveConveneRelease(release, {
            version: environment.appVersion,
            buildId,
            baseUrl: source,
            platform: environment.platform,
            runtimeInfo: environment.runtimeInfo,
            packageType,
            appImage: Option.isSome(config.appImagePath),
          }),
        ),
      ),
      Effect.timeout("15 seconds"),
      Effect.exit,
    );
    if (checking === epoch) checking = undefined;
    if (epoch !== generation) return { checked: false, state: yield* getState };
    const timestamp = yield* checkedAt;
    if (result._tag === "Failure") {
      yield* setState({
        ...previous,
        status: "error",
        availableVersion: null,
        message: CHECK_FAILED,
        errorContext: "check",
        canRetry: true,
        checkedAt: timestamp,
        convene: emptySource(source),
      });
    } else {
      const release = result.value;
      const available = release.relation === "newer" || release.relation === "different-build";
      yield* setState({
        ...previous,
        status: available
          ? "available"
          : release.relation === "unknown-build"
            ? "idle"
            : "up-to-date",
        availableVersion: available ? release.releaseVersion : null,
        checkedAt: timestamp,
        message: releaseMessage(release),
        errorContext: null,
        canRetry: false,
        convene: release,
      });
    }
    return { checked: true, state: yield* getState };
  });
  const rejectInstall = getState.pipe(
    Effect.map((current) => ({
      accepted: false,
      completed: false,
      state: { ...current, message: MANUAL_INSTALL },
    })),
  );
  return {
    getState,
    isActionActive: Effect.sync(() => checking !== undefined),
    isInstallActive: Effect.succeed(false),
    subscribe: mutex.withPermits(1)(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        return { latest: yield* getState, changes: Stream.fromSubscription(subscription) };
      }),
    ),
    emitState: getState.pipe(
      Effect.flatMap((current) => window.sendAll(IpcChannels.UPDATE_STATE_CHANNEL, current)),
    ),
    disabledReason: getState.pipe(
      Effect.map((current) =>
        current.enabled ? Option.none<string>() : Option.fromNullishOr(current.message),
      ),
    ),
    configure: Effect.gen(function* () {
      if (configured) return;
      configured = true;
      const scope = yield* Scope.Scope;
      yield* publisher.conveneUpdateSources.pipe(
        Stream.changes,
        Stream.runForEach((next) =>
          Effect.gen(function* () {
            if (next === baseUrl) return;
            generation += 1;
            baseUrl = next;
            checking = undefined;
            yield* setState({
              ...initial(),
              convene: emptySource(next),
              message: config.disableAutoUpdate ? initial().message : next ? null : CONNECT_FIRST,
            });
            if (next !== null) yield* check("connection").pipe(Effect.forkIn(scope));
          }),
        ),
        Effect.forkIn(scope),
      );
      yield* Effect.sleep("4 minutes").pipe(
        Effect.andThen(check("poll")),
        Effect.forever,
        Effect.forkIn(scope),
      );
    }),
    // The connected platform owns the release channel.
    setChannel: () => getState,
    check,
    download: Effect.gen(function* () {
      const current = yield* getState;
      const release = current.convene;
      const url = release?.downloadUrl ?? release?.downloadsUrl;
      if (
        !release ||
        (current.status !== "available" && current.errorContext !== "download") ||
        !url ||
        release.baseUrl !== baseUrl
      ) {
        return { accepted: false, completed: false, state: current };
      }
      const epoch = generation;
      const opened = yield* shell.openExternal(url);
      if (epoch !== generation)
        return { accepted: false, completed: false, state: yield* getState };
      if (!opened)
        yield* setState({
          ...current,
          status: "error",
          errorContext: "download",
          canRetry: true,
          message: "Could not open the platform download. Please try again.",
        });
      else if (current.errorContext === "download")
        yield* setState({
          ...current,
          status: "available",
          errorContext: null,
          canRetry: false,
          message: releaseMessage(release),
        });
      return { accepted: true, completed: opened, state: yield* getState };
    }),
    install: rejectInstall,
    installPrepared: () =>
      rejectInstall.pipe(Effect.map((result) => ({ ...result, failed: true }))),
  } satisfies DesktopUpdates["Service"];
});
