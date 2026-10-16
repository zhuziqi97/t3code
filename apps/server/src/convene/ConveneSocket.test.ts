import * as NodeHttp from "node:http";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import * as ConveneSocket from "./ConveneSocket.ts";

it.effect.each(["cancel", "timeout", "reject"] as const)(
  "closes a %s handshake without an unhandled Node error",
  (scenario) =>
    Effect.gen(function* () {
      const arrived = yield* Deferred.make<void>();
      const closed = yield* Deferred.make<void>();
      const server = NodeHttp.createServer();
      server.on("upgrade", (_request, socket) => {
        socket.on("end", () => socket.end());
        Deferred.doneUnsafe(arrived, Effect.void);
        if (scenario === "reject") socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      });
      yield* Effect.acquireRelease(
        Effect.promise(
          () => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)),
        ),
        () => Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
      );
      const address = server.address();
      assert.isNotNull(address);
      if (!address || typeof address === "string") return assert.fail("Expected TCP server");
      const running = yield* Effect.gen(function* () {
        const raw = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const socket = new NodeSocket.NodeWS.WebSocket(`ws://127.0.0.1:${address.port}`);
            socket.once("close", () => Deferred.doneUnsafe(closed, Effect.void));
            return socket;
          }),
          (socket) => Effect.sync(() => ConveneSocket.close(socket)),
        );
        const socket = yield* ConveneSocket.make(raw);
        return yield* socket.reader;
      }).pipe(Effect.scoped, Effect.forkScoped);
      yield* Deferred.await(arrived);
      if (scenario === "cancel") {
        yield* Fiber.interrupt(running);
      } else {
        if (scenario === "timeout") yield* TestClock.adjust("10 seconds");
        const failure = yield* Fiber.join(running).pipe(Effect.flip);
        assert.equal(failure.reason._tag, "SocketOpenError");
        if (scenario === "timeout" && failure.reason._tag === "SocketOpenError")
          assert.equal(failure.reason.kind, "Timeout");
      }
      yield* Deferred.await(closed);
    }).pipe(Effect.scoped),
);
