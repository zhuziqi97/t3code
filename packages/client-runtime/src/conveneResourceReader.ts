import { EnvironmentAuthorizationError, type ConveneResourceReadResult } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const isEnvironmentAuthorizationError = Schema.is(EnvironmentAuthorizationError);

export function conveneResourceTransportFailure(
  uri: string,
  error: unknown,
): ConveneResourceReadResult {
  return {
    resource_uri: uri,
    status: isEnvironmentAuthorizationError(error) ? "unauthorized" : "unavailable",
  };
}

export type ConveneResourceReaderState = {
  uri: string;
  pending: boolean;
  result: ConveneResourceReadResult | null;
};

/** A new location or permission invalidation discards content and any late result. */
export function createConveneResourceReader(
  read: (uri: string, page: number) => Promise<ConveneResourceReadResult>,
  changed: (state: ConveneResourceReaderState) => void,
) {
  let generation = 0;
  let state: ConveneResourceReaderState = { uri: "", pending: false, result: null };
  const clear = () => {
    generation++;
    state = { ...state, pending: false, result: null };
    changed(state);
  };
  const load = async (uri: string, page = 1) => {
    const request = ++generation;
    const previous = state.uri === uri ? state.result : null;
    state = {
      uri,
      pending: true,
      result: page > 1 && previous?.status === "ready" ? previous : null,
    };
    changed(state);
    let result: ConveneResourceReadResult;
    try {
      result = await read(uri, page);
    } catch {
      result = { status: "unavailable", resource_uri: uri };
    }
    if (request !== generation) return;
    if (result.status === "ready" && previous?.status === "ready" && page > 1) {
      const comments = new Map(previous.comments.map((comment) => [comment.number, comment]));
      for (const comment of result.comments) comments.set(comment.number, comment);
      result = { ...result, comments: [...comments.values()] };
    }
    state = { uri, pending: false, result };
    changed(state);
  };
  return { load, clear };
}

export function isConveneResourceLink(href: string): boolean {
  return href.startsWith("convene://");
}
