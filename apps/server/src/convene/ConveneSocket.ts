import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Socket from "effect/socket/Socket";

/** Reverse data streams wait for each Node send to flush before pulling more. */
export const make = (socket: NodeSocket.NodeWS.WebSocket) =>
  Effect.gen(function* () {
    const native = yield* Socket.fromWebSocket(Effect.succeed(socket));
    const opened = yield* Deferred.make<void>();
    const writer = yield* native.writer;
    const write = (frame: string | Uint8Array | Socket.CloseEvent) =>
      Deferred.await(opened).pipe(
        Effect.andThen(
          Socket.isCloseEvent(frame)
            ? writer.write(frame)
            : Effect.callback<void, Socket.SocketError>((resume) => {
                socket.send(frame, (cause) =>
                  resume(
                    cause
                      ? Effect.fail(
                          new Socket.SocketError({
                            reason: new Socket.SocketWriteError({ cause }),
                          }),
                        )
                      : Effect.void,
                  ),
                );
              }),
        ),
      );
    return Socket.make({
      reader: native.reader.pipe(Effect.tap(() => Deferred.succeed(opened, undefined))),
      writer: Effect.succeed({
        write,
        writeAll: (frames) => Effect.forEach(frames, write, { discard: true }),
      }),
    });
  });
