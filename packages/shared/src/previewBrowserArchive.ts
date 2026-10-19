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

// The one browser T3 installs on a host. HTML render previews and server
// browser tabs both run this pinned Chrome for Testing headless shell. Release
// packages carry the archive; source builds download it. Neither uses a browser
// the user installed. To bump the pin, pick a version
// from https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json,
// download each platform's chrome-headless-shell zip, and replace the version
// and every byte count and SHA-256 below. Hosts drop the old build after the
// new one installs.
const VERSION = "154.0.8037.92";
const ARCHIVES = {
  linux64: {
    bytes: 120_477_194,
    sha256: "636aa5c79f2693632e9921b8bbb050038ba11672e02346c06c20f991aed096f9",
  },
  "linux-arm64": {
    bytes: 121_182_296,
    sha256: "0ed0e47d9e9f639197f508d62ada09e5c6b4c4c60edab3160a9312a733091df6",
  },
  "mac-arm64": {
    bytes: 99_221_129,
    sha256: "77da14e75d7f2568e6f7898d3df7cdc6faac74b15e903b2c9d486ebb6ca9b929",
  },
  "mac-x64": {
    bytes: 104_748_425,
    sha256: "a54292aaacbb77f76f6ef47558e7c51ab884044e0adacca315567f83c060bcc4",
  },
  win32: {
    bytes: 114_295_943,
    sha256: "56b30d2d6c35775ebf8dc3618680f6529e1c38c87f7feb28a16e9904273d51f7",
  },
  win64: {
    bytes: 120_822_223,
    sha256: "3ac2561f02d9d87aadc0399d00b9002d718a4c365624fa67db9e7bfaf6b1a568",
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
