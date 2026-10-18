import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ServerConfig from "../config.ts";
import { readConvenePlatformUrls } from "./ConveneConnection.ts";

const layer = ServerConfig.layerTest(process.cwd(), { prefix: "t3-convene-presets-" }).pipe(
  Layer.provideMerge(NodeServices.layer),
);
it.effect("loads environment-local presets and uses no built-in deployment addresses", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    assert.deepEqual(yield* readConvenePlatformUrls, []);
    const filename = path.join(config.stateDir, "convene-platforms.json");
    const urls = ["https://one.example.test", "https://two.example.test/"];
    yield* fs.makeDirectory(config.stateDir, { recursive: true });
    yield* fs.writeFileString(filename, JSON.stringify(urls));
    assert.deepEqual(yield* readConvenePlatformUrls, urls);
    yield* fs.writeFileString(filename, "invalid JSON");
    assert.deepEqual(yield* readConvenePlatformUrls, []);
  }).pipe(Effect.provide(layer)),
);

it.effect("keeps packaged production presets even when an old QA preset file remains", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const defaults = ["https://production.example.test", "https://remote.example.test/"];
    const read = readConvenePlatformUrls.pipe(
      Effect.provideService(ServerConfig.ServerConfig, {
        ...config,
        convenePlatformUrls: defaults,
      }),
    );
    assert.deepEqual(yield* read, defaults);
    yield* fs.makeDirectory(config.stateDir, { recursive: true });
    yield* fs.writeFileString(
      path.join(config.stateDir, "convene-platforms.json"),
      '["http://127.0.0.1:12345"]',
    );
    assert.deepEqual(yield* read, defaults);
  }).pipe(Effect.provide(layer)),
);
