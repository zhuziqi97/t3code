// @effect-diagnostics-next-line nodeBuiltinImport:off - The native vendor's JSON editing boundary returns filesystem Promises.
import * as NodeFSP from "node:fs/promises";
import * as NodeVM from "node:vm";
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

type LanguageItem = {
  id: string;
  label: string;
  description?: string;
  extensionId?: string;
};

it.effect.each([
  { renderer: "zh-cn", prepared: false },
  { renderer: "zh-cn", prepared: true },
  { renderer: "en", prepared: false },
  { renderer: "en", prepared: true },
])(
  "marks only renderer $renderer current with cached native preparation=$prepared",
  ({ renderer, prepared }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const runtime = path.join(config.baseDir, "tools", "code-server", "4.141.0-linux-x64");
      const native = path.join(runtime, "lib", "vscode", "out", "server-main.js");
      const workbench = path.join(
        runtime,
        "lib",
        "vscode",
        "out",
        "vs",
        "code",
        "browser",
        "workbench",
        "workbench.js",
      );
      const executable = path.join(runtime, "bin", "code-server");
      const argv = path.join(config.baseDir, "tools", "code-server", "data", "User", "argv.json");
      const fixtures = path.join(import.meta.dirname, "fixtures");
      const browserSource = yield* fs.readFileString(
        path.join(fixtures, "code-server-4.141.0-language-picker.txt"),
      );
      const serverSource = yield* fs.readFileString(
        path.join(fixtures, "code-server-4.141.0-installed-languages.txt"),
      );
      yield* fs.makeDirectory(path.dirname(workbench), { recursive: true });
      yield* fs.makeDirectory(path.dirname(executable), { recursive: true });
      yield* fs.makeDirectory(path.dirname(argv), { recursive: true });
      yield* fs.writeFileString(
        native,
        "i.set(Uu,F.createInstance(pl));" +
          (prepared ? "await F.invokeFunction(a=>a.get(Uu).update());" : ""),
      );
      yield* fs.writeFileString(workbench, browserSource);
      yield* fs.writeFileString(executable, "cached runtime");
      yield* fs.writeFileString(
        argv,
        JSON.stringify({ locale: renderer, "enable-crash-reporter": false }),
      );
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
      assert.equal(yield* installation.ensure(), executable);
      yield* installation.prepareLanguage();
      const patched = yield* fs.readFileString(workbench);
      const installed = yield* Effect.promise<LanguageItem[]>(() =>
        NodeVM.runInNewContext(
          `const native = ${serverSource}; native.cache = { getLanguagePacks: async () => ({ "zh-cn": { label: "中文(简体)", extensions: [{ extensionIdentifier: { id: "MS-CEINTL.vscode-language-pack-zh-hans" } }] } }) }; native.getInstalledLanguages();`,
          { pn: "en", d: () => " (Current)" },
        ),
      );
      assert.deepEqual(
        installed.filter((item) => item.description?.includes("(Current)")).map((item) => item.id),
        ["en"],
      );
      const current = renderer === "zh-cn" ? " (当前)" : " (Current)";
      const vendor: {
        drt: new (...services: unknown[]) => {
          getInstalledLanguages(): Promise<LanguageItem[]>;
          getAvailableLanguages(): Promise<LanguageItem[]>;
        };
        VFt: new (...services: unknown[]) => { setLocale(item: LanguageItem): Promise<void> };
      } = NodeVM.runInNewContext(patched + ";({drt,VFt})", {
        x: class {
          dispose() {}
        },
        Ne: class {
          token = {};
          cancel() {}
        },
        setTimeout: () => 0,
        Ds: renderer,
        oS: { value: () => renderer, isDefaultVariant: () => renderer === "en" },
        d: (index: number) => (index === 3669 ? current : String(index)),
        BCe: { toService: (channel: unknown) => channel },
      });
      const remote = { getInstalledLanguages: async () => installed };
      const packs = new vendor.drt(
        { getConnection: () => ({ getChannel: () => remote }) },
        {},
        {
          query: async () => ({
            firstPage: [
              {
                identifier: { id: "MS-CEINTL.vscode-language-pack-zh-hans" },
                properties: { localizedLanguages: ["中文(简体)"] },
                tags: ["lp-zh-cn"],
              },
              {
                identifier: { id: "MS-CEINTL.vscode-language-pack-ja" },
                properties: { localizedLanguages: ["日本語"] },
                tags: ["lp-ja"],
                installCount: 1500000,
              },
            ],
          }),
        },
        {},
      );
      const options = yield* Effect.promise(() => packs.getInstalledLanguages());
      const available = yield* Effect.promise(() => packs.getAvailableLanguages());
      for (const list of [options, available]) {
        assert.deepEqual(
          list
            .filter(
              (item) =>
                item.description?.includes(current) || item.description?.includes(" (Current)"),
            )
            .map((item) => item.id),
          [renderer],
        );
      }
      assert.equal(
        options.find((item) => item.id === "zh-cn")?.extensionId,
        "MS-CEINTL.vscode-language-pack-zh-hans",
      );
      assert.include(available.find((item) => item.id === "ja")?.description ?? "", "1.5M");
      let confirmed = false;
      let restarts = 0;
      let prompts = 0;
      const selection = new vendor.VFt(
        {
          write: (
            resource: string,
            edits: Array<{ path: string[]; value: string }>,
            save: boolean,
          ) => {
            assert.equal(resource, argv);
            assert.deepEqual(edits[0]?.path, ["locale"]);
            assert.equal(save, true);
            return NodeFSP.readFile(resource, "utf8").then((content) =>
              NodeFSP.writeFile(
                resource,
                JSON.stringify({ ...JSON.parse(content), locale: edits[0]!.value }),
              ),
            );
          },
        },
        { argvResource: argv },
        {
          error: (error: unknown) => {
            throw error;
          },
        },
        packs,
        {},
        {},
        {},
        {},
        {},
        {
          confirm: async () => {
            prompts++;
            return { confirmed };
          },
        },
        {
          restart: async () => {
            restarts++;
          },
        },
        { nameLong: "code-server" },
      );
      const selected = options.find((item) => item.id !== renderer)!;
      yield* Effect.promise(() =>
        selection.setLocale(options.find((item) => item.id === renderer)!),
      );
      assert.equal(prompts, 0);
      yield* Effect.promise(() => selection.setLocale(selected));
      assert.equal(JSON.parse(yield* fs.readFileString(argv)).locale, renderer);
      assert.equal(restarts, 0);
      confirmed = true;
      yield* Effect.promise(() => selection.setLocale(selected));
      assert.equal(prompts, 2);
      assert.equal(restarts, 1);
      assert.deepEqual(JSON.parse(yield* fs.readFileString(argv)), {
        locale: selected.id,
        "enable-crash-reporter": false,
      });
      yield* installation.prepareLanguage();
      assert.equal(yield* fs.readFileString(workbench), patched);
      assert.equal(JSON.parse(yield* fs.readFileString(argv)).locale, selected.id);
    }).pipe(
      Effect.provide(base),
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provideService(HostProcess.Architecture, "x64"),
    ),
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

it.effect("leaves both bundles intact when the fixed browser adapter is unrecognized", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const out = path.join(
      config.baseDir,
      "tools",
      "code-server",
      "4.141.0-linux-x64",
      "lib",
      "vscode",
      "out",
    );
    const native = path.join(out, "server-main.js");
    const workbench = path.join(out, "vs", "code", "browser", "workbench", "workbench.js");
    yield* fs.makeDirectory(path.dirname(workbench), { recursive: true });
    const source = "i.set(Uu,F.createInstance(pl));";
    yield* fs.writeFileString(native, source);
    yield* fs.writeFileString(workbench, "unexpected browser adapter");
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
    const result = yield* Effect.exit(installation.prepareLanguage());
    assert.equal(result._tag, "Failure");
    assert.equal(yield* fs.readFileString(native), source);
    assert.equal(yield* fs.readFileString(workbench), "unexpected browser adapter");
  }).pipe(
    Effect.provide(base),
    Effect.provideService(HostProcess.Platform, "linux"),
    Effect.provideService(HostProcess.Architecture, "x64"),
  ),
);
