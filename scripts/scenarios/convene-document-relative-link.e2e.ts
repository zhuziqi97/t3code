import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { ORCHESTRATION_PROTOCOL_VERSION, ThreadId, WsRpcGroup } from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import { expect } from "e2e";

import { T3_HOME } from "../e2e.config.ts";
import { makeState, runPromise, test, WEB } from "./t3.ts";
import { ScenarioError } from "./shell.ts";

function decode<T>(schema: Schema.Decoder<T>, value: unknown): T {
  const result = Schema.decodeUnknownOption(schema)(value);
  if (Option.isNone(result)) throw new Error("Invalid isolated Convene scenario input or response");
  return result.value;
}

const inputSchema = Schema.Struct({
  platformUrl: Schema.String,
  username: Schema.String,
  passwordEnvFile: Schema.String,
  readmeUri: Schema.String,
  phaseUri: Schema.String,
  relativeLinkText: Schema.String,
  phaseHeading: Schema.String,
});
const readText = (path: string) =>
  runPromise(Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(path)));
const sessionSchema = Schema.Struct({ sessionId: Schema.String, token: Schema.String });
const threadSchema = Schema.Struct({ threadId: Schema.String });
const loginSchema = Schema.Struct({ data: Schema.Struct({ access_token: Schema.String }) });
const approvalSchema = Schema.Struct({ data: Schema.Struct({ runner_id: Schema.String }) });

test(
  "A normal Convene document link resolves relative to its source document",
  WEB,
  async ({ t3, app, screen, browser }) => {
    const inputFile = process.env.T3_CONVENE_SCENARIO_INPUT;
    if (!inputFile) throw new Error("Set T3_CONVENE_SCENARIO_INPUT to the isolated fixture input");
    const input = decode(Schema.fromJsonString(inputSchema), await readText(inputFile));
    if (new URL(input.platformUrl).hostname !== "127.0.0.1" || input.username === "root")
      throw new Error("This scenario requires a loopback QA platform and its dedicated reader");
    const { DEFAULT_ROOT_PASSWORD: password } = decode(
      Schema.fromJsonString(Schema.Struct({ DEFAULT_ROOT_PASSWORD: Schema.String })),
      await readText(input.passwordEnvFile),
    );
    let token: string | undefined;
    let runnerId: string | undefined;
    let sessionId: string | undefined;
    const { cli } = makeState(T3_HOME);
    const post = (path: string, body: Record<string, unknown>) =>
      Effect.runPromise(
        Effect.gen(function* () {
          let request = HttpClientRequest.post(
            new URL(`/api/v1/${path}`, input.platformUrl).href,
          ).pipe(HttpClientRequest.bodyJsonUnsafe(body));
          if (token)
            request = request.pipe(HttpClientRequest.setHeader("Authorization", `Bearer ${token}`));
          const response = yield* HttpClient.execute(request).pipe(
            Effect.mapError(
              () => new ScenarioError({ message: `Convene scenario ${path}: transport failed` }),
            ),
          );
          if (response.status < 200 || response.status >= 300)
            return yield* new ScenarioError({
              message: `Convene scenario ${path}: HTTP ${response.status}`,
            });
          return yield* response.json.pipe(
            Effect.mapError(
              () => new ScenarioError({ message: `Convene scenario ${path}: invalid JSON` }),
            ),
          );
        }).pipe(Effect.provide(FetchHttpClient.layer), Effect.scoped),
      );
    try {
      token = decode(loginSchema, await post("auth/login", { username: input.username, password }))
        .data.access_token;
      const project = await t3.project("relative-doc", {
        "README.md": `[Open scenario documentation](${input.readmeUri})\n`,
      });
      const started = await runPromise(
        cli([
          "thread",
          "start",
          project,
          "Start",
          "--title",
          "Relative document scenario",
          "--provider",
          "devReplay",
          "--model",
          "multi-turn",
          "--wait",
          "--json",
        ]),
      );
      const { threadId } = decode(Schema.fromJsonString(threadSchema), started.stdout);
      const issued = await runPromise(
        cli([
          "auth",
          "session",
          "issue",
          "--scope",
          "orchestration:read",
          "--scope",
          "environment:maintain",
          "--label",
          "Convene relative document scenario",
          "--json",
        ]),
      );
      const session = decode(Schema.fromJsonString(sessionSchema), issued.stdout);
      sessionId = session.sessionId;
      await t3.open();
      const origin = await browser.evaluate<string>("location.origin");
      const socketUrl = new URL("/ws", origin);
      socketUrl.protocol = "ws:";
      socketUrl.searchParams.set("orchestrationProtocol", String(ORCHESTRATION_PROTOCOL_VERSION));
      const protocol = RpcClient.layerProtocolSocket({
        retryTransientErrors: false,
        retryPolicy: Schedule.recurs(0),
      }).pipe(
        Layer.provide(
          Layer.merge(
            NodeSocket.layerWebSocket(socketUrl.href, {
              headers: { Authorization: `Bearer ${session.token}` },
            }),
            RpcSerialization.layerJson,
          ),
        ),
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* RpcClient.make(WsRpcGroup);
          const pairing = yield* client["convene.manage"]({
            operation: "pair",
            baseUrl: input.platformUrl,
          });
          if (pairing.type !== "pairing") throw new Error("Expected a new isolated pairing");
          const approved = yield* Effect.promise(() =>
            post("execution-runner-pairings/approve", {
              user_code: pairing.pairing.user_code,
              runner_display_name: "Relative document scenario",
            }),
          );
          runnerId = decode(approvalSchema, approved).data.runner_id;
          yield* client["convene.manage"]({
            operation: "exchange",
            baseUrl: input.platformUrl,
            deviceCode: pairing.pairing.device_code,
          });
          yield* client["convene.subscribeStatus"]({}).pipe(
            Stream.filter((status) => status.phase === "online"),
            Stream.take(1),
            Stream.runDrain,
          );
          const readable = yield* client["convene.readResource"]({
            threadId: ThreadId.make(threadId),
            uri: input.readmeUri,
            page: 1,
          });
          if (readable.status !== "ready")
            throw new Error(`Isolated document setup is not readable: ${readable.status}`);
        }).pipe(Effect.provide(protocol), Effect.scoped),
      );

      await screen.getByText("Relative document scenario", { exact: true }).first().tap();
      const sourcePath = await browser.evaluate<string>("location.href");
      await browser.keyboard.press("Control+p");
      await screen.getByRole("combobox").fill("README.md");
      await screen.getByRole("option", /README\.md/).tap();
      await screen.getByRole("button", /显示 Markdown 预览|Show rendered markdown/).tap();
      await screen.getByText("Open scenario documentation", { exact: true }).tap();
      await screen.getByText(input.relativeLinkText, { exact: true }).tap();
      await app.screenshot("convene-relative-document");
      await expect(screen.getByRole("heading", input.phaseHeading)).toBeVisible();
      await expect(screen.getByText(input.phaseUri, { exact: true })).toBeVisible();
      await expect(browser).toHaveURL(sourcePath);
    } finally {
      try {
        if (runnerId) {
          await post("execution-runners/delete", { runner_id: runnerId });
          await Effect.runPromise(Effect.logInfo(`Removed scenario runner ${runnerId}`));
        }
      } finally {
        try {
          if (token) await post("auth/logout", {});
        } finally {
          if (sessionId) await runPromise(cli(["auth", "session", "revoke", sessionId]));
        }
      }
    }
  },
);
