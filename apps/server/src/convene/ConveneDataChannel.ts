import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {
  ConveneNativeRequest,
  ConveneNativeResult,
  ConveneDataControl,
  ConveneHttpOpen,
  ConveneWsOpen,
  ConveneHttpEnd,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import * as Socket from "effect/socket/Socket";
import * as ConveneNative from "./ConveneNative.ts";
import * as ConvenePlatform from "./ConvenePlatform.ts";
import * as ConveneWeb from "./ConveneWeb.ts";
import * as ConveneSocket from "./ConveneSocket.ts";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeHttpOpen = Schema.decodeUnknownEffect(Schema.fromJsonString(ConveneHttpOpen));
const decodeHttpEnd = Schema.decodeUnknownEffect(Schema.fromJsonString(ConveneHttpEnd));
const decodeWsOpen = Schema.decodeUnknownEffect(Schema.fromJsonString(ConveneWsOpen));
const decodeNativeRequest = Schema.decodeUnknownEffect(Schema.fromJsonString(ConveneNativeRequest));
const encodeNativeResult = Schema.encodeEffect(ConveneNativeResult);

/** Native module operations and full owner Web access have distinct entry frames. */
export const open = Effect.fn("ConveneDataChannel.open")(function* (
  baseUrl: string,
  control: typeof ConveneDataControl.Type,
) {
  const platform = yield* ConvenePlatform.ConvenePlatform;
  const native = yield* ConveneNative.ConveneNative;
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/api/v1/execution-runners/data`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const token = yield* platform.accessToken;
  const rawSocket = yield* Effect.acquireRelease(
    Effect.sync(() => new NodeSocket.NodeWS.WebSocket(url)),
    (socket) => Effect.sync(() => ConveneSocket.close(socket)),
  );
  const socket = yield* ConveneSocket.make(rawSocket);
  const writer = yield* socket.writer;
  const { pull } = yield* socket.reader;
  const send = (value: object) =>
    encodeJson(value).pipe(
      Effect.flatMap((text) => writer.writeAll([text])),
      Effect.timeout("180 seconds"),
    );
  // A native Web response may finish before the platform has sent HTTP_END.
  // Keep the data socket until the platform consumes HTTP_DONE and closes it.
  const finishHttp = send({ TYPE: "HTTP_DONE" }).pipe(
    Effect.andThen(
      Effect.callback<void>((resume) => {
        if (rawSocket.readyState >= NodeSocket.NodeWS.WebSocket.CLOSING) {
          resume(Effect.void);
          return;
        }
        const closed = () => resume(Effect.void);
        rawSocket.once("close", closed);
        return Effect.sync(() => rawSocket.off("close", closed));
      }),
    ),
  );
  yield* send({ TYPE: "AUTHENTICATE", TOKEN: token });
  yield* send({
    TYPE: "BIND_DATA_CHANNEL",
    REQUEST_ID: control.REQUEST_ID,
    CONNECTION_ID: control.CONNECTION_ID,
  });
  const frames = yield* pull;
  const first = typeof frames[0] === "string" ? frames[0] : "";
  if (control.KIND === "WS") {
    const request = yield* decodeWsOpen(first);
    const web = yield* ConveneWeb.ConveneWeb;
    const upstream = yield* web.websocket(request.PATH, request.PROTOCOL);
    const upstreamWriter = yield* upstream.writer;
    const upstreamReader = yield* upstream.reader;
    yield* send({ TYPE: "WS_ACCEPT" });
    const incoming = Effect.gen(function* () {
      if (frames.length > 1)
        yield* upstreamWriter.writeAll(
          frames.slice(1) as [Uint8Array | string, ...Array<Uint8Array | string>],
        );
      while (true) yield* upstreamWriter.writeAll(yield* pull);
    });
    const outgoing = Effect.gen(function* () {
      while (true) yield* writer.writeAll(yield* upstreamReader.pull);
    });
    yield* Effect.raceFirst(incoming, outgoing).pipe(
      Effect.catchTags({
        SocketError: (error) => {
          const close = new Socket.CloseEvent(
            error.reason._tag === "SocketCloseError" &&
              ![1005, 1006, 1015].includes(error.reason.code)
              ? error.reason.code
              : 1011,
            error.reason._tag === "SocketCloseError" ? error.reason.closeReason : undefined,
          );
          return writer.write(close).pipe(Effect.andThen(upstreamWriter.write(close)));
        },
      }),
    );
    return;
  }
  const request = yield* decodeHttpOpen(first);
  const bodyStream = Stream.fromIterable(frames.slice(1)).pipe(
    Stream.concat(Stream.fromPull(Effect.succeed(pull))),
    Stream.mapEffect((frame) =>
      typeof frame === "string"
        ? decodeHttpEnd(frame).pipe(Effect.as(Option.none<Uint8Array>()))
        : Effect.succeedSome(frame),
    ),
    Stream.takeWhile(Option.isSome),
    Stream.map(Option.getOrThrow),
  );
  if (request.ACCESS === "WEB") {
    const web = yield* ConveneWeb.ConveneWeb;
    const response = yield* web.http({
      method: request.METHOD,
      path: request.PATH,
      headers: request.HEADERS,
      body: bodyStream,
    });
    yield* send({
      TYPE: "HTTP_RESPONSE",
      STATUS: response.status,
      HEADERS: Object.entries(response.headers).filter(
        ([key]) =>
          !["set-cookie", "content-length", "transfer-encoding", "connection"].includes(
            key.toLowerCase(),
          ),
      ),
    });
    if (request.METHOD !== "HEAD" && response.status !== 204 && response.status !== 304)
      yield* response.stream.pipe(
        Stream.runForEach((chunk) =>
          Effect.gen(function* () {
            for (let offset = 0; offset < chunk.length; offset += 48 * 1024)
              yield* writer
                .writeAll([chunk.subarray(offset, offset + 48 * 1024)])
                .pipe(Effect.timeout("180 seconds"));
          }),
        ),
      );
    yield* finishHttp;
    return;
  }
  const respond = Effect.fn("ConveneDataChannel.respond")(function* (
    status: number,
    result: unknown,
  ) {
    const json = yield* encodeJson(result);
    const body = new TextEncoder().encode(json);
    yield* send({
      TYPE: "HTTP_RESPONSE",
      STATUS: status,
      HEADERS: [["content-type", "application/json"]],
    });
    for (let offset = 0; offset < body.length; offset += 48 * 1024)
      yield* writer
        .writeAll([body.subarray(offset, offset + 48 * 1024)])
        .pipe(Effect.timeout("180 seconds"));
    yield* finishHttp;
  });
  if (request.METHOD !== "POST" || request.PATH !== "/api/convene/native") {
    yield* respond(404, { code: "NOT_FOUND", message: "The native endpoint was not found." });
    return;
  }
  const chunks = yield* Stream.runCollect(bodyStream);
  const body = new TextDecoder().decode(Buffer.concat(chunks));
  yield* decodeNativeRequest(body).pipe(
    Effect.flatMap(native.handle),
    Effect.flatMap(encodeNativeResult),
    Effect.flatMap((result) => respond(200, result)),
    Effect.catchTags({
      SchemaError: () =>
        respond(400, { code: "invalid_request", message: "The native request is invalid." }),
      ConveneNativeError: (error) =>
        Effect.logWarning("Convene native operation failed", error).pipe(
          Effect.andThen(respond(400, { code: error.category, message: error.message })),
        ),
    }),
  );
});
