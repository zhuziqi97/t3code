import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as AcpSchema from "effect-acp/compat";

const Configuration = Schema.Record(Schema.String, Schema.Unknown);
const decodeConfiguration = Schema.decodeUnknownOption(Configuration);
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Configuration));
const Server = Schema.Struct({
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  serverUrl: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  disabled: Schema.optional(Schema.Boolean),
});
const decodeServer = Schema.decodeUnknownOption(Server);

/** Reads the user's cross-surface MCP file without populating the private Google profile. */
export const readAntigravityUserMcpServers = Effect.fn("readAntigravityUserMcpServers")(function* (
  userHome: string,
  geminiHome?: string,
  cwd = userHome,
): Effect.fn.Return<ReadonlyArray<AcpSchema.McpServer>, never, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configuredHome = geminiHome || path.join(userHome, ".gemini");
  const expandedHome =
    configuredHome === "~"
      ? userHome
      : configuredHome.startsWith("~/")
        ? path.join(userHome, configuredHome.slice(2))
        : configuredHome;
  const sourceHome = path.resolve(cwd, expandedHome);
  const contents = yield* fs
    .readFileString(path.join(sourceHome, "config", "mcp_config.json"))
    .pipe(
      Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed("{}")),
      Effect.catch(() =>
        Effect.logWarning("Could not read Antigravity system MCP configuration.").pipe(
          Effect.as("{}"),
        ),
      ),
    );
  const root = decodeJson(contents);
  const configuration = Option.isSome(root)
    ? decodeConfiguration(root.value.mcpServers === undefined ? root.value : root.value.mcpServers)
    : Option.none();
  if (Option.isNone(configuration)) {
    yield* Effect.logWarning("Invalid Antigravity system MCP configuration.");
    return [];
  }
  const servers: Array<AcpSchema.McpServer> = [];
  for (const [name, raw] of Object.entries(configuration.value)) {
    const decoded = decodeServer(raw);
    if (Option.isNone(decoded)) {
      yield* Effect.logWarning("Invalid Antigravity system MCP server configuration.", {
        server: name,
      });
      continue;
    }
    const config = decoded.value;
    if (config.disabled) continue;
    const original = Option.getOrThrow(decodeConfiguration(raw));
    // The pinned ACP 1.3 runtime cannot represent these native 2.x options.
    // Dropping them would change authentication, working directory or tools.
    if (
      original.oauth !== undefined ||
      original.authProviderType !== undefined ||
      original.cwd !== undefined ||
      (Array.isArray(original.disabledTools) && original.disabledTools.length > 0)
    ) {
      yield* Effect.logWarning(
        "Antigravity ACP does not support this system MCP server's authentication, cwd or tool filters.",
        { server: name },
      );
      continue;
    }
    if (config.command !== undefined) {
      servers.push({
        name,
        command: config.command,
        args: config.args ?? [],
        env: Object.entries(config.env ?? {}).map(([name, value]) => ({ name, value })),
      });
    } else if (config.serverUrl !== undefined || config.url !== undefined) {
      servers.push({
        type: "http",
        name,
        url: config.serverUrl ?? config.url!,
        headers: Object.entries(config.headers ?? {}).map(([name, value]) => ({ name, value })),
      });
    } else {
      yield* Effect.logWarning("Antigravity system MCP server requires command or serverUrl.", {
        server: name,
      });
    }
  }
  return servers;
});
