// @effect-diagnostics nodeBuiltinImport:off - Pinned archives use an incremental digest and Electron's ASAR-aware fs.
import * as NodeStream from "@effect/platform-node/NodeStream";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as NodeCrypto from "node:crypto";
// Electron patches the default fs object for ASAR, but its ESM named exports remain unpatched.
// oxlint-disable-next-line t3code/namespace-node-imports -- ASAR reads need Electron's patched default export.
import NodeFS from "node:fs";

// HTML previews and server tabs share this pinned headless Chrome. Packages carry it; source builds download it.
// When bumping, update every platform archive size and SHA-256 from Chrome for Testing.
export const VERSION = "158.0.8127.88";
const ARCHIVES = {
  linux64: {
    bytes: 132_091_593,
    sha256: "63401333cc587645bfaeea7f0c90958b327d249251e23954a47f30112ca23d5b",
  },
  "linux-arm64": {
    bytes: 129_942_265,
    sha256: "9f89b7ef6574e4bbf6ddda9f17f1fab5626e93d6f7d852653232d0d3554df975",
  },
  "mac-arm64": {
    bytes: 105_060_087,
    sha256: "69320f6869c4defbbdac8b8fa83aef65dc63975e83bbd06899b75dbea5c464b3",
  },
  "mac-x64": {
    bytes: 112_314_759,
    sha256: "dc1ac31965cb2ec7794aed8c66127aceea304ae15353cd56fc4b8bde44091548",
  },
  win32: {
    bytes: 122_509_314,
    sha256: "936ad5e7f530bdd66b7261d0a2ceed76b057d429cf31b770a95fd903a7969856",
  },
  win64: {
    bytes: 127_879_225,
    sha256: "e935ea2d4633495b5e9ab7bc66bcd982806329c0ee9ecbafc1ac9596a3b34cdb",
  },
} as const;

const chromePlatform = (platform: NodeJS.Platform, arch: NodeJS.Architecture) => {
  switch (platform) {
    case "linux":
      return arch === "x64" ? "linux64" : arch === "arm64" ? "linux-arm64" : null;
    case "darwin":
      return arch === "arm64" ? "mac-arm64" : arch === "x64" ? "mac-x64" : null;
    case "win32":
      // There is no Windows arm64 build; Windows on Arm runs the x64 one under emulation.
      return arch === "ia32" ? "win32" : arch === "x64" || arch === "arm64" ? "win64" : null;
    default:
      return null;
  }
};

export interface PreviewBrowserRelease {
  readonly version: string;
  /** Chrome for Testing's platform name, which also names the archive's top directory. */
  readonly platform: string;
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
}

export const previewBrowserRelease = (
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): PreviewBrowserRelease | null => {
  const chrome = chromePlatform(platform, arch);
  return chrome === null
    ? null
    : {
        version: VERSION,
        platform: chrome,
        url: `https://storage.googleapis.com/chrome-for-testing-public/${VERSION}/${chrome}/chrome-headless-shell-${chrome}.zip`,
        ...ARCHIVES[chrome],
      };
};

export class PreviewBrowserInstallError extends Schema.TaggedError<PreviewBrowserInstallError>()(
  "PreviewBrowserInstallError",
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return `T3 could not install its headless browser: ${this.detail} Try again.`;
  }
}
const isInstallError = Schema.is(PreviewBrowserInstallError);

const DOWNLOAD_TIMEOUT = "15 minutes";

export const wrapPreviewBrowserFailure = (detail: string) => (cause: unknown) =>
  isInstallError(cause) ? cause : new PreviewBrowserInstallError({ detail, cause });

/** Build and runtime use the same pinned archive acquisition and verification. */
export const downloadPreviewBrowserArchive = Effect.fn("PreviewBrowser.downloadArchive")(
  function* (input: {
    readonly release: PreviewBrowserRelease;
    readonly archivePath: string;
    readonly bundledDirectory?: string | undefined;
    readonly onProgress?: (downloadedBytes: number) => void;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const release = input.release;
    const bundled =
      input.bundledDirectory !== undefined && NodeFS.existsSync(input.bundledDirectory);
    const source = bundled
      ? NodeStream.fromReadable<Uint8Array, PreviewBrowserInstallError>({
          evaluate: () =>
            NodeFS.createReadStream(
              path.join(input.bundledDirectory!, release.version, `${release.platform}.zip`),
            ),
          onError: wrapPreviewBrowserFailure("Could not read the bundled browser component."),
        })
      : (yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const response = yield* http
            .execute(HttpClientRequest.get(release.url))
            .pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
          return response.stream;
        })).pipe(
          Stream.mapError(wrapPreviewBrowserFailure("Could not download the browser component.")),
        );
    const hash = NodeCrypto.createHash("sha256");
    let downloadedBytes = 0;
    yield* source.pipe(
      Stream.tap((chunk) =>
        Effect.gen(function* () {
          downloadedBytes += chunk.byteLength;
          input.onProgress?.(downloadedBytes);
          if (downloadedBytes > release.bytes) {
            return yield* new PreviewBrowserInstallError({
              detail: "The archive was larger than the pinned release.",
            });
          }
          hash.update(chunk);
        }),
      ),
      Stream.run(fs.sink(input.archivePath, { flag: "wx", mode: 0o600 })),
    );
    if (downloadedBytes !== release.bytes || hash.digest("hex") !== release.sha256) {
      return yield* new PreviewBrowserInstallError({
        detail: "The archive failed its size or SHA-256 check. Nothing was installed.",
      });
    }
  },
  Effect.timeout(DOWNLOAD_TIMEOUT),
  Effect.mapError(
    wrapPreviewBrowserFailure(
      "Could not read the browser component from the application or download source.",
    ),
  ),
);
