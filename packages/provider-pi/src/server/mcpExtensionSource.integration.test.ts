// @effect-diagnostics nodeBuiltinImport:off -- The shipped Pi extension uses native fetch against an isolated HTTP fixture.
import * as NodeHttp from "node:http";
import { assert, describe, expect, it } from "@effect/vitest";
import { loadMcpBridge } from "./mcpBridge.testkit.ts";

describe("Pi project MCP HTTP bridge", () => {
  it("retries a failed catalog with a fresh protocol session", async () => {
    let initializations = 0;
    const closed: string[] = [];
    const fixtureFetch: typeof fetch = async (_input, init) => {
      const headers = init?.headers as Record<string, string>;
      if (init?.method === "DELETE") {
        closed.push(headers["mcp-session-id"]!);
        return new Response(null, { status: 204 });
      }
      const message = JSON.parse(String(init?.body)) as { id?: number; method: string };
      if (message.method === "initialize") {
        if (headers["mcp-session-id"] !== undefined)
          return new Response("Expired session", { status: 404 });
        initializations += 1;
        return Response.json(
          { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-03-26" } },
          { headers: { "mcp-session-id": `session-${initializations}` } },
        );
      }
      if (message.method === "tools/list" && initializations === 1)
        return new Response("Catalog unavailable", { status: 503 });
      return Response.json({
        jsonrpc: "2.0",
        id: message.id,
        result:
          message.method === "tools/list"
            ? { tools: [{ name: "read", inputSchema: { type: "object" } }] }
            : { content: [{ type: "text", text: "recovered" }] },
      });
    };
    const bridge = await loadMcpBridge({ fetch: fixtureFetch });
    assert.equal(bridge.tools.length, 0);
    await bridge.handlers.get("session_start")!(
      { systemPrompt: "" },
      { ui: { notify: assert.fail } },
    );
    assert.equal(initializations, 2);
    assert.deepEqual(closed, ["session-1"]);
    assert.equal((await bridge.tools[0]!.execute("recovered", {})).content[0]?.text, "recovered");
  });

  it.each([false, true])(
    "routes identical tools with independent credentials and sessions, modern=%s",
    async (modern) => {
      const requests: Array<{ path: string; method: string; session?: string }> = [];
      const server = NodeHttp.createServer(async (request, response) => {
        const path = request.url!;
        const protocolVersion = path === "/builtin" ? "2025-06-18" : "2025-03-26";
        assert.equal(
          request.headers.authorization,
          path === "/builtin" ? "Bearer builtin" : "Token project",
        );
        if (request.method === "DELETE") {
          assert.equal(request.headers["mcp-protocol-version"], protocolVersion);
          requests.push({
            path,
            method: "DELETE",
            session: request.headers["mcp-session-id"] as string,
          });
          response.writeHead(204).end();
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const message = JSON.parse(Buffer.concat(chunks).toString()) as {
          id?: number;
          method: string;
        };
        const session = request.headers["mcp-session-id"] as string | undefined;
        requests.push({
          path,
          method: message.method,
          ...(session === undefined ? {} : { session }),
        });
        if (
          message.method !== "initialize" &&
          request.headers["mcp-protocol-version"] !== protocolVersion
        ) {
          response.writeHead(400).end("Wrong negotiated MCP protocol version");
          return;
        }
        if (message.method !== "initialize") assert.equal(session, `session${path}`);
        if (message.id === undefined) {
          response.writeHead(202).end();
          return;
        }
        const result =
          message.method === "tools/list"
            ? {
                tools: [
                  {
                    name: "read",
                    annotations: { readOnlyHint: true },
                    inputSchema: { type: "object" },
                  },
                ],
              }
            : message.method === "tools/call"
              ? { content: [{ type: "text", text: path }] }
              : {
                  protocolVersion,
                  capabilities: {},
                  serverInfo: { name: path, version: "1" },
                };
        response.writeHead(200, {
          "content-type": "application/json",
          "mcp-session-id": `session${path}`,
        });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const address = server.address();
        if (typeof address !== "object" || address === null)
          throw new Error("HTTP fixture has no address");
        const origin = `http://127.0.0.1:${address.port}`;
        const bridge = await loadMcpBridge({
          modern,
          toolSearchAvailable: true,
          fetch: globalThis.fetch,
          environment: {
            T3_MCP_URL: `${origin}/builtin`,
            T3_MCP_BEARER_TOKEN: "builtin",
            T3_PI_MCP_SERVERS: JSON.stringify({
              convene: { endpoint: `${origin}/project`, authorizationHeader: "Token project" },
            }),
          },
        });
        const builtin = bridge.tools.find((tool) => tool.name === "mcp__t3-code__read")!;
        const project = bridge.tools.find((tool) => tool.name === "mcp__convene__read")!;
        assert.isDefined(project, "The project catalog must use its negotiated protocol version");
        assert.equal(builtin.exposure, modern ? "deferred" : undefined);
        assert.equal(project.exposure, modern ? "deferred" : undefined);
        assert.equal((await builtin.execute("builtin-read", {})).content[0]?.text, "/builtin");
        assert.equal((await project.execute("project-read", {})).content[0]?.text, "/project");
        const aborted = new AbortController();
        aborted.abort();
        await expect(project.execute("cancelled", {}, aborted.signal)).rejects.toThrow();
        await bridge.handlers.get("session_shutdown")!(
          { systemPrompt: "" },
          { ui: { notify: assert.fail } },
        );
        for (const path of ["/builtin", "/project"]) {
          assert.deepEqual(
            requests.filter((entry) => entry.path === path).map((entry) => entry.method),
            ["initialize", "notifications/initialized", "tools/list", "tools/call", "DELETE"],
          );
        }
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );

  it("keeps builtin tools usable when the project service fails and retries it on session start", async () => {
    let projectAvailable = false;
    const warnings: string[] = [];
    const fixtureFetch: typeof fetch = async (input, init) => {
      const project = String(input).includes("project");
      if (project && !projectAvailable) return new Response("unauthorized", { status: 401 });
      const message = JSON.parse(String(init?.body)) as { id?: number; method: string };
      return Response.json({
        jsonrpc: "2.0",
        id: message.id,
        result:
          message.method === "tools/list"
            ? { tools: [{ name: "read", inputSchema: { type: "object" } }] }
            : { content: [{ type: "text", text: project ? "project" : "builtin" }] },
      });
    };
    const bridge = await loadMcpBridge({
      fetch: fixtureFetch,
      environment: {
        T3_PI_MCP_SERVERS: JSON.stringify({
          convene: {
            endpoint: "http://project.invalid/mcp",
            authorizationHeader: "Bearer private-project-token",
          },
        }),
      },
    });
    assert.equal((await bridge.tools[0]!.execute("builtin", {})).content[0]?.text, "builtin");
    const context = { ui: { notify: (message: string) => warnings.push(message) } };
    await bridge.handlers.get("session_start")!({ systemPrompt: "" }, context);
    assert.deepEqual(warnings, ["convene MCP unavailable."]);
    projectAvailable = true;
    await bridge.handlers.get("session_start")!({ systemPrompt: "" }, context);
    assert.equal(
      (
        await bridge.tools
          .find((tool) => tool.name === "mcp__convene__read")!
          .execute("project", {})
      ).content[0]?.text,
      "project",
    );
  });
});
