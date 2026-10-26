// @effect-diagnostics nodeBuiltinImport:off - Real HTTP and WS peers exercise the adapter's streaming boundary.
import * as NodeHttp from "node:http";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { assert, it } from "@effect/vitest";
import {
  AuthFilesystemWriteScope,
  AuthTerminalOperateScope,
  AuthSessionId,
  ConveneIdeResult,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  FetchHttpClient,
  HttpBody,
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServer,
} from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ConveneIde from "./ConveneIde.ts";
import * as ConveneIdeHttp from "./ConveneIdeHttp.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeResult = Schema.decodeUnknownEffect(ConveneIdeResult);
const OPEN = {
  operation: "OPEN",
  service: "code-server",
  projectId: "project",
  workspaceKey: "root",
};
const fixture = Effect.gen(function* () {
  const received: Array<{ path: string; cookie?: string; authorization?: string }> = [];
  const server = NodeHttp.createServer((request, response) => {
    received.push({
      path: request.url!,
      ...(request.headers.cookie === undefined ? {} : { cookie: request.headers.cookie }),
      ...(request.headers.authorization === undefined
        ? {}
        : { authorization: request.headers.authorization }),
    });
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/login", "set-cookie": "native=fake; Path=/" });
      response.end();
    } else if (request.url === "/relative") {
      response.writeHead(302, { location: "./" });
      response.end();
    } else {
      response.writeHead(200, { "content-type": "text/html", "set-cookie": "native=fake; Path=/" });
      response.end("<html><body>native untouched</body></html>");
    }
  });
  const ws = new NodeSocket.NodeWS.WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    received.push({
      path: request.url!,
      ...(request.headers.cookie === undefined ? {} : { cookie: request.headers.cookie }),
      ...(request.headers.authorization === undefined
        ? {}
        : { authorization: request.headers.authorization }),
    });
    ws.handleUpgrade(request, socket, head, (client) => {
      client.on("message", (message, binary) => client.send(message, { binary }));
    });
  });
  yield* Effect.acquireRelease(
    Effect.promise(() => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))),
    () =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            for (const client of ws.clients) client.terminate();
            ws.close();
            server.close(() => resolve());
          }),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  if (!address || typeof address === "string") return yield* Effect.die("Expected TCP fixture");
  let managementCalls = 0;
  let result: ConveneIdeResult = {
    service: "code-server",
    version: "4.141.0",
    phase: "ready",
    runtimeId: "runtime",
    entryPath: "api/convene/ide/code-server/runtime/?folder=workspace",
    error: null,
  };
  const ide = ConveneIde.ConveneIde.of({
    handle: () =>
      Effect.sync(() => {
        managementCalls++;
        return result;
      }),
    changes: Stream.never,
    upstream: (id) =>
      id === "runtime"
        ? Effect.succeed(`http://127.0.0.1:${address.port}`)
        : Effect.fail(new ConveneIde.ConveneIdeError({ code: "runtime_unavailable" })),
  });
  const auth = Layer.mock(EnvironmentAuth.EnvironmentAuth, {
    authenticateWebSocketUpgrade: (request) => {
      const credential = request.headers.authorization?.slice("Bearer ".length);
      if (!credential) return Effect.fail(new EnvironmentAuth.ServerAuthMissingCredentialError());
      const scopes: ReadonlyArray<AuthEnvironmentScope> =
        credential === "full"
          ? [AuthFilesystemWriteScope, AuthTerminalOperateScope]
          : credential === "files"
            ? [AuthFilesystemWriteScope]
            : [AuthTerminalOperateScope];
      return Effect.succeed({
        sessionId: AuthSessionId.make("ide-auth-fixture"),
        subject: "owner",
        method: "bearer-access-token" as const,
        scopes,
      });
    },
  });
  const services = yield* Layer.build(
    HttpRouter.serve(ConveneIdeHttp.layer, { disableListenLog: true }).pipe(
      Layer.provide(Layer.succeed(ConveneIde.ConveneIde, ide)),
      Layer.provide(auth),
      Layer.provideMerge(
        NodeHttpServer.layer(NodeHttp.createServer, { port: 0, host: "127.0.0.1" }),
      ),
      Layer.provideMerge(
        FetchHttpClient.layer.pipe(
          Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { redirect: "manual" })),
        ),
      ),
    ),
  );
  const origin = HttpServer.formatAddress(Context.get(services, HttpServer.HttpServer).address);
  return {
    origin,
    received,
    http: Context.get(services, HttpClient.HttpClient),
    calls: () => managementCalls,
    setResult: (value: ConveneIdeResult) => {
      result = value;
    },
  };
});

it.live("preserves optional preparation facts over HTTP and still decodes old results", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    const legacy = {
      service: "code-server",
      version: "4.141.0",
      phase: "ready",
      runtimeId: "runtime",
      entryPath: "api/convene/ide/code-server/runtime/?folder=workspace",
      error: null,
    } as const;
    const results: ConveneIdeResult[] = [
      legacy,
      {
        ...legacy,
        phase: "installing",
        entryPath: null,
        progress: { stage: "downloading", receivedBytes: 17, totalBytes: 23 },
      },
      {
        ...legacy,
        phase: "installing",
        entryPath: null,
        progress: { stage: "downloading", receivedBytes: 17 },
      },
      {
        ...legacy,
        phase: "installing",
        entryPath: null,
        progress: { stage: "configuring-language" },
      },
      { ...legacy, warning: { code: "language_setup_failed" } },
    ];
    for (const expected of results) {
      test.setResult(expected);
      const response = yield* test.http.post(test.origin + "/api/convene/ide", {
        headers: { authorization: "Bearer full" },
        body: HttpBody.text(encodeJson(OPEN), "application/json"),
      });
      assert.equal(response.status, 200);
      const value = yield* response.json;
      assert.deepEqual<unknown>(value, expected);
      assert.deepEqual(yield* decodeResult(value), expected);
    }
    assert.equal(test.calls(), results.length);
    assert.deepEqual(test.received, []);
  }),
);

it.live(
  "requires both filesystem write and terminal operate before management or native HTML",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      for (const [credential, expected] of [
        [undefined, 401],
        ["files", 403],
        ["terminal", 403],
        ["full", 200],
      ] as const) {
        const headers = {
          "content-type": "application/json",
          ...(credential ? { authorization: `Bearer ${credential}` } : {}),
        };
        for (const path of ["/api/convene/ide", "/api/convene/ide/code-server/runtime/"]) {
          const response = yield* test.http.execute(
            HttpClientRequest.make(path === "/api/convene/ide" ? "POST" : "GET")(
              test.origin + path,
              {
                headers,
                ...(path === "/api/convene/ide"
                  ? { body: HttpBody.text(encodeJson(OPEN), "application/json") }
                  : {}),
              },
            ),
          );
          assert.equal(response.status, expected);
          yield* response.arrayBuffer;
        }
      }
      assert.equal(test.calls(), 1);
      assert.equal(test.received.length, 1);
      const invalid = yield* test.http.post(test.origin + "/api/convene/ide", {
        headers: { authorization: "Bearer full" },
        body: HttpBody.text(
          encodeJson({ ...OPEN, service: "arbitrary-port", port: 3000 }),
          "application/json",
        ),
      });
      assert.equal(invalid.status, 400);
      assert.equal(test.calls(), 1);
    }).pipe(Effect.scoped),
);

it.live(
  "preserves native HTML and session-relative redirects while stripping both directions' cookies",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      const prefix = "/api/convene/ide/code-server/runtime";
      const headers = {
        authorization: "Bearer full",
        cookie: "platform=fake",
        origin: "http://browser-entry",
      };
      const response = yield* test.http.get(test.origin + prefix + "/?wsTicket=one-use", {
        headers,
      });
      assert.equal(yield* response.text, "<html><body>native untouched</body></html>");
      assert.isUndefined(response.headers["set-cookie"]);
      for (const [path, location] of [
        ["redirect", prefix + "/login"],
        ["relative", "./"],
      ]) {
        const result = yield* test.http.get(test.origin + prefix + "/" + path, { headers });
        assert.equal(result.status, 302);
        assert.equal(result.headers["location"], location);
        assert.isUndefined(result.headers["set-cookie"]);
        yield* result.arrayBuffer;
      }
      assert.deepEqual(test.received, [
        { path: "/" },
        { path: "/redirect" },
        { path: "/relative" },
      ]);
      const stale = yield* test.http.get(test.origin + "/api/convene/ide/code-server/stale/", {
        headers,
      });
      assert.equal(stale.status, 503);
    }).pipe(Effect.scoped),
);

it.live("bridges real WebSocket frames to the managed runtime without forwarding credentials", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    const echo = yield* Effect.acquireRelease(
      Effect.sync(
        () =>
          new NodeSocket.NodeWS.WebSocket(
            test.origin.replace(/^http/, "ws") +
              "/api/convene/ide/code-server/runtime/socket?wsTicket=one-use",
            { headers: { authorization: "Bearer full", cookie: "platform=fake" } },
          ),
      ),
      (socket) => Effect.sync(() => socket.terminate()),
    );
    const result = yield* Effect.tryPromise(
      () =>
        new Promise<string>((resolve, reject) => {
          echo.once("error", reject);
          echo.once("open", () => echo.send("native-editor-and-terminal-frame"));
          echo.once("message", (data) => resolve(data.toString()));
        }),
    );
    assert.equal(result, "native-editor-and-terminal-frame");
    assert.deepEqual(test.received, [{ path: "/socket" }]);
  }).pipe(Effect.scoped),
);
