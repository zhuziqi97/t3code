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
const VERSION = "156.0.8078.70";
const ARCHIVES = {
  linux64: {
    bytes: 126_646_931,
    sha256: "a313da592261ff1e342c1e507d315f25b1809006c0508f77ce86151d464d4ccb",
  },
  "linux-arm64": {
    bytes: 126_749_876,
    sha256: "dca11213d2e0b1db52141edd9f92ec423fd52ca25715846790d84fa1d5d16e8a",
  },
  "mac-arm64": {
    bytes: 103_901_293,
    sha256: "1f848385611f2e58122e68969489712661880fc9a92c9dd20428099f9998ba7b",
  },
  "mac-x64": {
    bytes: 109_387_968,
    sha256: "ab4cc2949f88439e2241b2712c49268f24982f2d25af87960466cc22bdc2e6e1",
  },
  win32: {
    bytes: 119_029_359,
    sha256: "37dc9a03f37fd79637fec9f26042bf32f04cfe5b83749d980eb1e7d1a429d47c",
  },
  win64: {
    bytes: 126_214_071,
    sha256: "41c6aa97046d05d015b817a95f7b1512c3a1a41b18364f8da46478ae520400b1",
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
