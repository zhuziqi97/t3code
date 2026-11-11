import * as NodeWS from "@effect/platform-node/NodeWS";
import {
  ConveneNativeRequest,
  ConveneNativeResult,
  ConveneDataControl,
  ConveneHttpOpen,
  ConveneWsOpen,
  ConveneHttpEnd,
  ConveneDataResult,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
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
  report?: (result: typeof ConveneDataResult.Type) => Effect.Effect<void, Socket.SocketError>,
  receivedAt?: bigint,
) {
  const started = receivedAt ?? (yield* Clock.currentTimeNanos);
  let stage: typeof ConveneDataResult.Type.STAGE = "token";
  const timings: {
    -readonly [
      K in keyof typeof ConveneDataResult.Type.TIMINGS_MS
    ]: (typeof ConveneDataResult.Type.TIMINGS_MS)[K];
  } = {};
  const mark = (name: keyof typeof timings) =>
    Clock.currentTimeNanos.pipe(
      Effect.map((now) => {
        timings[name] ??= Number(now - started) / 1e6;
      }),
    );
  const observation = () =>
    control.REPORT_THRESHOLD_MS === undefined ? {} : { TIMINGS_MS: { ...timings } };
  return yield* Effect.gen(function* () {
    const platform = yield* ConvenePlatform.ConvenePlatform;
    const native = yield* ConveneNative.ConveneNative;
    const url = new URL(`${baseUrl.replace(/\/$/, "")}/api/v1/execution-runners/data`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const token = yield* platform.accessToken;
    yield* mark("token_ready");
    stage = "connect";
    const rawSocket = yield* Effect.acquireRelease(
      Effect.sync(() => new NodeWS.WebSocket(url)),
      (socket) => Effect.sync(() => ConveneSocket.close(socket)),
    );
    const socket = yield* ConveneSocket.make(rawSocket);
    const writer = yield* socket.writer;
    const { pull } = yield* socket.reader;
    yield* mark("socket_open");
    const send = (value: object) =>
      encodeJson(value).pipe(
        Effect.flatMap((text) => writer.writeAll([text])),
        Effect.timeout("180 seconds"),
      );
    // A native Web response may finish before the platform has sent HTTP_END.
    // Keep the data socket until the platform consumes HTTP_DONE and closes it.
    const finishHttp = mark("body_done").pipe(
      Effect.andThen(() => {
        stage = "close";
        return send({ TYPE: "HTTP_DONE", ...observation() });
      }),
      Effect.andThen(
        Effect.callback<void>((resume) => {
          if (rawSocket.readyState >= NodeWS.WebSocket.CLOSING) {
            resume(Effect.void);
            return;
          }
          const closed = () => resume(Effect.void);
          rawSocket.once("close", closed);
          return Effect.sync(() => rawSocket.off("close", closed));
        }),
      ),
      Effect.tap(() => mark("socket_closed")),
    );
    stage = "authenticate";
    yield* send({ TYPE: "AUTHENTICATE", TOKEN: token });
    stage = "bind";
    yield* send({
      TYPE: "BIND_DATA_CHANNEL",
      REQUEST_ID: control.REQUEST_ID,
      CONNECTION_ID: control.CONNECTION_ID,
      ...observation(),
    });
    yield* mark("bind_sent");
    stage = "request";
    const frames = yield* pull;
    yield* mark("request_received");
    const first = typeof frames[0] === "string" ? frames[0] : "";
    if (control.KIND === "WS") {
      const request = yield* decodeWsOpen(first);
      const web = yield* ConveneWeb.ConveneWeb;
      stage = "upstream";
      const upstream = yield* web.websocket(request.PATH, request.PROTOCOL);
      const upstreamWriter = yield* upstream.writer;
      const upstreamReader = yield* upstream.reader;
      yield* mark("response_headers");
      stage = "body";
      yield* send({ TYPE: "WS_ACCEPT", ...observation() });
      const incoming = Effect.gen(function* () {
        if (frames.length > 1)
          yield* upstreamWriter.writeAll(
            frames.slice(1) as [Uint8Array | string, ...Array<Uint8Array | string>],
          );
        while (true) yield* upstreamWriter.writeAll(yield* pull);
      });
      const outgoing = Effect.gen(function* () {
        while (true) {
          const frames = yield* upstreamReader.pull;
          if (timings.first_body === undefined) yield* mark("first_body");
          yield* writer.writeAll(frames);
        }
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
      yield* mark("body_done");
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
      stage = "upstream";
      const response = yield* web.http({
        method: request.METHOD,
        path: request.PATH,
        headers: request.HEADERS,
        body: bodyStream,
      });
      yield* mark("response_headers");
      stage = "body";
      yield* send({
        TYPE: "HTTP_RESPONSE",
        STATUS: response.status,
        ...observation(),
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
              if (timings.first_body === undefined) yield* mark("first_body");
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
      yield* mark("response_headers");
      stage = "body";
      yield* send({
        TYPE: "HTTP_RESPONSE",
        STATUS: status,
        ...observation(),
        HEADERS: [["content-type", "application/json"]],
      });
      if (body.length > 0) yield* mark("first_body");
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
    stage = "upstream";
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
  }).pipe(
    Effect.scoped,
    Effect.onExit((exit) =>
      Effect.gen(function* () {
        const elapsed = Number((yield* Clock.currentTimeNanos) - started) / 1e6;
        // The platform cancels this child after consuming HTTP_DONE.
        const complete =
          Exit.isSuccess(exit) ||
          (Exit.hasInterrupts(exit) && stage === "close" && timings.body_done !== undefined);
        // Only platforms requesting reports understand the additive result frame.
        if (
          control.REPORT_THRESHOLD_MS === undefined ||
          (complete && elapsed < control.REPORT_THRESHOLD_MS)
        )
          return;
        const failure = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none();
        const error = Option.getOrUndefined(failure);
        const errorCode =
          error?._tag === "SocketError"
            ? error.reason._tag === "SocketCloseError"
              ? `SocketCloseError:${error.reason.code}`
              : error.reason._tag === "SocketOpenError"
                ? `SocketOpenError:${error.reason.kind}`
                : error.reason._tag
            : (error?._tag ?? (Exit.hasInterrupts(exit) ? "Interrupted" : "Defect"));
        const result: typeof ConveneDataResult.Type = {
          TYPE: "DATA_CHANNEL_RESULT",
          REQUEST_ID: control.REQUEST_ID,
          CONNECTION_ID: control.CONNECTION_ID,
          OUTCOME: complete ? "complete" : Exit.hasInterrupts(exit) ? "cancelled" : "failed",
          STAGE: complete ? "done" : stage,
          ELAPSED_MS: elapsed,
          ...(complete ? {} : { ERROR_CODE: errorCode }),
          TIMINGS_MS: timings,
        };
        yield* Effect.logInfo("Convene data channel result", result);
        if (report)
          yield* report(result).pipe(
            Effect.interruptible,
            Effect.timeout("1 second"),
            Effect.catchCause(() =>
              Effect.logWarning("Convene data result could not be delivered", result),
            ),
          );
      }),
    ),
  );
});
