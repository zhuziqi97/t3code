import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { makeAcpMcpOverAcpBridge } from "./mcpOverAcpBridge.ts";

describe("AcpMcpOverAcpBridge", () => {
  it.effect("forwards authenticated MCP requests and closes the negotiated session", () =>
    Effect.gen(function* () {
      const requests: Array<{
        readonly method: string;
        readonly headers: Headers;
        readonly body: unknown;
      }> = [];
      const bridge = yield* makeAcpMcpOverAcpBridge({
        servers: {
          "t3-code": {
            endpoint: "http://127.0.0.1:1/mcp",
            authorizationHeader: "Bearer bridge-test",
          },
        },
        allocateConnectionId: Effect.succeed("connection-1"),
        fetchImplementation: async (_url, init) => {
          const method = init?.method ?? "GET";
          const headers = new Headers(init?.headers);
          const body = init?.body === undefined ? null : JSON.parse(String(init.body));
          requests.push({ method, headers, body });
          if (method === "DELETE") return new Response(null, { status: 204 });
          if (body === null || typeof body !== "object") return new Response(null, { status: 202 });
          const request = body as { readonly id?: unknown; readonly method?: unknown };
          if (request.method === "notifications/initialized") {
            return new Response(null, { status: 202 });
          }
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: request.id,
              result:
                request.method === "initialize"
                  ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: {} }
                  : { tools: [] },
            }),
            {
              headers: { "content-type": "application/json", "mcp-session-id": "session-42" },
            },
          );
        },
      });

      const connected = yield* bridge.connect({ serverId: "t3-code" });
      expect(connected).toEqual({ connectionId: "connection-1" });
      expect(
        yield* bridge.message({ connectionId: connected.connectionId, method: "initialize" }),
      ).toMatchObject({ protocolVersion: "2025-06-18" });
      expect(
        yield* bridge.message({ connectionId: connected.connectionId, method: "tools/list" }),
      ).toEqual({ tools: [] });
      yield* bridge.notification({
        connectionId: connected.connectionId,
        method: "notifications/initialized",
      });
      yield* bridge.disconnect({ connectionId: connected.connectionId });

      expect(requests[0]?.headers.get("authorization")).toBe("Bearer bridge-test");
      expect(requests[1]?.headers.get("mcp-session-id")).toBe("session-42");
      expect(requests[1]?.headers.get("mcp-protocol-version")).toBe("2025-06-18");
      expect(requests.at(-1)?.method).toBe("DELETE");
      expect(requests.at(-1)?.headers.get("mcp-session-id")).toBe("session-42");
    }),
  );

  it.effect(
    "routes project tools and fork credentials independently and disposes every connection",
    () =>
      Effect.gen(function* () {
        const requests: Array<{
          url: string;
          authorization: string | null;
          method: string;
          session: string | null;
        }> = [];
        let nextId = 0;
        const bridge = yield* makeAcpMcpOverAcpBridge({
          servers: {
            "source:t3-code": {
              endpoint: "http://127.0.0.1/t3",
              authorizationHeader: "Bearer builtin",
            },
            "source:convene": {
              endpoint: "http://127.0.0.1/convene",
              authorizationHeader: "Bearer source",
            },
          },
          allocateConnectionId: Effect.sync(() => String(++nextId)),
          fetchImplementation: async (url, init) => {
            const headers = new Headers(init?.headers);
            const authorization = headers.get("authorization");
            requests.push({
              url,
              authorization,
              method: init?.method ?? "GET",
              session: headers.get("mcp-session-id"),
            });
            if (init?.method === "DELETE") return new Response(null, { status: 204 });
            const request = JSON.parse(String(init?.body)) as { id: number; method: string };
            const result =
              request.method === "initialize"
                ? { protocolVersion: "2025-06-18" }
                : request.method === "tools/list"
                  ? { tools: [{ name: "read", inputSchema: { type: "object" } }] }
                  : { content: [{ type: "text", text: authorization }] };
            return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
              headers: {
                "content-type": "application/json",
                "mcp-session-id": `session-${authorization}`,
              },
            });
          },
        });
        const builtin = yield* bridge.connect({ serverId: "source:t3-code" });
        const source = yield* bridge.connect({ serverId: "source:convene" });
        yield* bridge.registerServers({
          "target:convene": {
            endpoint: "http://127.0.0.1/convene",
            authorizationHeader: "Bearer target",
          },
        });
        const target = yield* bridge.connect({ serverId: "target:convene" });
        for (const connection of [builtin, source, target]) {
          yield* bridge.message({ ...connection, method: "initialize" });
          expect(yield* bridge.message({ ...connection, method: "tools/list" })).toMatchObject({
            tools: [{ name: "read" }],
          });
        }
        expect(
          yield* bridge.message({
            ...source,
            method: "tools/call",
            params: { name: "read", arguments: {} },
          }),
        ).toEqual({ content: [{ type: "text", text: "Bearer source" }] });
        expect(
          yield* bridge.message({
            ...target,
            method: "tools/call",
            params: { name: "read", arguments: {} },
          }),
        ).toEqual({ content: [{ type: "text", text: "Bearer target" }] });
        yield* bridge.dispose;
        expect(requests.filter((request) => request.method === "DELETE")).toEqual([
          {
            url: "http://127.0.0.1/t3",
            authorization: "Bearer builtin",
            method: "DELETE",
            session: "session-Bearer builtin",
          },
          {
            url: "http://127.0.0.1/convene",
            authorization: "Bearer source",
            method: "DELETE",
            session: "session-Bearer source",
          },
          {
            url: "http://127.0.0.1/convene",
            authorization: "Bearer target",
            method: "DELETE",
            session: "session-Bearer target",
          },
        ]);
        expect(
          yield* bridge.message({ ...target, method: "tools/list" }).pipe(Effect.flip),
        ).toMatchObject({ _tag: "AcpMcpOverAcpError" });
      }),
  );

  it.effect("aborts an in-flight HTTP request when the ACP call is interrupted", () =>
    Effect.gen(function* () {
      const started = Promise.withResolvers<AbortSignal>();
      const bridge = yield* makeAcpMcpOverAcpBridge({
        servers: {
          "t3-code": {
            endpoint: "http://127.0.0.1:1/mcp",
            authorizationHeader: "Bearer bridge-test",
          },
        },
        allocateConnectionId: Effect.succeed("connection-1"),
        fetchImplementation: (_url, init) => {
          if (!init?.signal) throw new Error("Missing cancellation signal");
          started.resolve(init.signal);
          return new Promise<Response>(() => {});
        },
      });
      const connected = yield* bridge.connect({ serverId: "t3-code" });
      const request = yield* bridge
        .message({ connectionId: connected.connectionId, method: "tools/list" })
        .pipe(Effect.forkChild);
      const signal = yield* Effect.promise(() => started.promise);
      yield* Fiber.interrupt(request);
      expect(signal.aborted).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.effect("rejects unknown servers, connections, and oversized messages", () =>
    Effect.gen(function* () {
      const bridge = yield* makeAcpMcpOverAcpBridge({
        servers: {
          "t3-code": {
            endpoint: "http://127.0.0.1:1/mcp",
            authorizationHeader: "Bearer bridge-test",
          },
        },
        allocateConnectionId: Effect.succeed("connection-1"),
        fetchImplementation: () => Promise.resolve(new Response(null, { status: 202 })),
      });

      expect(yield* bridge.connect({ serverId: "other" }).pipe(Effect.flip)).toMatchObject({
        _tag: "AcpMcpOverAcpError",
      });
      expect(
        yield* bridge.message({ connectionId: "missing", method: "tools/list" }).pipe(Effect.flip),
      ).toMatchObject({ _tag: "AcpMcpOverAcpError" });

      const connected = yield* bridge.connect({ serverId: "t3-code" });
      const failure = yield* bridge
        .message({
          connectionId: connected.connectionId,
          method: "tools/call",
          params: { payload: "x".repeat(8 * 1024 * 1024) },
        })
        .pipe(Effect.flip);
      expect(failure.message).toContain("exceeds 8 MiB");
    }),
  );
});
