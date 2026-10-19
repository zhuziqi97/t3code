import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { readAntigravityUserMcpServers } from "./antigravityMcpSupport.ts";

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fs.makeTempDirectoryScoped();
  const directory = path.join(home, ".gemini", "config");
  yield* fs.makeDirectory(directory, { recursive: true });
  const configPath = path.join(directory, "mcp_config.json");
  return { fs, home, configPath, read: readAntigravityUserMcpServers(home) };
});

describe("Antigravity system MCP", () => {
  it.effect("respects the original GEMINI_HOME without changing the private profile", () =>
    Effect.gen(function* () {
      const h = yield* fixture;
      const path = yield* Path.Path;
      const customHome = path.join(h.home, "custom-gemini");
      yield* h.fs.makeDirectory(path.join(customHome, "config"), { recursive: true });
      const source = '{"mcpServers":{"custom":{"command":"custom-tool"}}}';
      yield* h.fs.writeFileString(path.join(customHome, "config", "mcp_config.json"), source);
      for (const sourceHome of [customHome, "~/custom-gemini", "custom-gemini"]) {
        expect(
          (yield* readAntigravityUserMcpServers(h.home, sourceHome, h.home)).map(
            (server) => server.name,
          ),
        ).toEqual(["custom"]);
      }
      expect(yield* h.read).toEqual([]);
      expect(yield* h.fs.readFileString(path.join(customHome, "config", "mcp_config.json"))).toBe(
        source,
      );
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect(
    "preserves command, arguments, environment and remote headers without changing the source",
    () =>
      Effect.gen(function* () {
        const h = yield* fixture;
        const source =
          JSON.stringify(
            {
              mcpServers: {
                local: {
                  command: "/test/node",
                  args: ["/fixture/server.mjs", "two words"],
                  env: { TEST_SECRET: "fixture-local" },
                },
                remote: {
                  serverUrl: "http://127.0.0.1:1234/mcp",
                  headers: { Authorization: "Bearer fixture-remote" },
                },
                legacy: { url: "http://127.0.0.1:1235/mcp" },
                disabled: { command: "never-start", disabled: true },
              },
            },
            null,
            2,
          ) + "\n";
        yield* h.fs.writeFileString(h.configPath, source);
        expect(yield* h.read).toEqual([
          {
            name: "local",
            command: "/test/node",
            args: ["/fixture/server.mjs", "two words"],
            env: [{ name: "TEST_SECRET", value: "fixture-local" }],
          },
          {
            name: "remote",
            type: "http",
            url: "http://127.0.0.1:1234/mcp",
            headers: [{ name: "Authorization", value: "Bearer fixture-remote" }],
          },
          { name: "legacy", type: "http", url: "http://127.0.0.1:1235/mcp", headers: [] },
        ]);
        expect(yield* h.fs.readFileString(h.configPath)).toBe(source);
        expect(yield* h.fs.exists(h.home + "/config/mcp_config.json")).toBe(false);
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("re-reads edits, removals and a missing file without retaining old services", () =>
    Effect.gen(function* () {
      const h = yield* fixture;
      expect(yield* h.read).toEqual([]);
      yield* h.fs.writeFileString(h.configPath, JSON.stringify({ first: { command: "first" } }));
      expect((yield* h.read).map((s) => s.name)).toEqual(["first"]);
      yield* h.fs.writeFileString(
        h.configPath,
        JSON.stringify({ mcpServers: { second: { command: "second" } } }),
      );
      expect((yield* h.read).map((s) => s.name)).toEqual(["second"]);
      yield* h.fs.remove(h.configPath);
      expect(yield* h.read).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("leaves malformed configuration untouched and keeps valid independent servers", () =>
    Effect.gen(function* () {
      const h = yield* fixture;
      for (const source of [
        "{invalid",
        "[]",
        '{"mcpServers":null,"other":{"command":"do-not-run"}}',
      ]) {
        yield* h.fs.writeFileString(h.configPath, source);
        expect(yield* h.read).toEqual([]);
        expect(yield* h.fs.readFileString(h.configPath)).toBe(source);
      }
      yield* h.fs.writeFileString(
        h.configPath,
        JSON.stringify({
          mcpServers: {
            invalid: { command: ["wrong"] },
            valid: { command: "valid" },
          },
        }),
      );
      expect((yield* h.read).map((s) => s.name)).toEqual(["valid"]);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect(
    "does not silently discard authentication or native restrictions unsupported by ACP 1.3",
    () =>
      Effect.gen(function* () {
        const h = yield* fixture;
        yield* h.fs.writeFileString(
          h.configPath,
          JSON.stringify({
            mcpServers: {
              oauth: {
                serverUrl: "http://127.0.0.1/mcp",
                oauth: { clientSecret: "fixture-secret" },
              },
              google: { serverUrl: "http://127.0.0.1/mcp", authProviderType: "google_credentials" },
              cwd: { command: "node", cwd: "/specific/directory" },
              filtered: { command: "node", disabledTools: ["write"] },
              valid: { command: "valid" },
            },
          }),
        );
        expect((yield* h.read).map((s) => s.name)).toEqual(["valid"]);
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});
