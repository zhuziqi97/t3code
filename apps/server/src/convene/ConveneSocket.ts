import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Socket from "effect/socket/Socket";

export const close = (socket: NodeSocket.NodeWS.WebSocket) => {
  if (socket.readyState === NodeSocket.NodeWS.WebSocket.CLOSED) return;
  // The Effect reader detaches before the owning scope closes the socket.
  // Node ws emits an error when a pending handshake is closed, so retain a
  // listener through the close event after the reader has reported its failure.
  const onError = () => {};
  socket.on("error", onError);
  socket.once("close", () => socket.off("error", onError));
  socket.close(1000);
};

/** Reverse data streams wait for each Node send to flush before pulling more. */
export const make = Effect.fn("ConveneSocket.make")(function* (
  socket: NodeSocket.NodeWS.WebSocket,
) {
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
