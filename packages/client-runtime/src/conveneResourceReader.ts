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
  needsRefresh: boolean;
  result: ConveneResourceReadResult | null;
};

/** A new location or permission invalidation discards content and any late result. */
export function createConveneResourceReader(
  read: (uri: string, page: number, startLine?: number) => Promise<ConveneResourceReadResult>,
  changed: (state: ConveneResourceReaderState) => void,
) {
  let generation = 0;
  let state: ConveneResourceReaderState = {
    uri: "",
    pending: false,
    needsRefresh: false,
    result: null,
  };
  const clear = () => {
    generation++;
    state = { ...state, pending: false, needsRefresh: false, result: null };
    changed(state);
  };
  const load = async (uri: string, page = 1, startLine?: number) => {
    const continuation = page > 1 || (startLine !== undefined && startLine > 1);
    if (state.uri === uri && state.needsRefresh && continuation) return;
    const request = ++generation;
    const previous = state.uri === uri ? state.result : null;
    state = {
      uri,
      pending: true,
      needsRefresh: false,
      result: continuation && previous?.status === "ready" ? previous : null,
    };
    changed(state);
    let result: ConveneResourceReadResult;
    try {
      result = await read(uri, page, startLine);
    } catch {
      result = { status: "unavailable", resource_uri: uri };
    }
    if (request !== generation) return;
    let needsRefresh = false;
    if (result.status === "ready" && previous?.status === "ready" && continuation) {
      if ("document" in previous && "document" in result) {
        if (
          result.resource_uri !== previous.resource_uri ||
          result.document.id !== previous.document.id ||
          result.document.version !== previous.document.version ||
          startLine !== previous.slice.next_start_line ||
          result.slice.start_line !== startLine
        ) {
          result = previous;
          needsRefresh = true;
        } else {
          result = {
            ...result,
            content: previous.content + result.content,
            slice: {
              ...result.slice,
              start_line: previous.slice.start_line,
              returned_lines: previous.slice.returned_lines + result.slice.returned_lines,
              has_more_before: previous.slice.has_more_before,
              truncated: previous.slice.has_more_before || result.slice.has_more_after,
            },
          };
        }
      } else if (
        "issue" in previous &&
        "issue" in result &&
        result.resource_uri === previous.resource_uri &&
        page > 1
      ) {
        const comments = new Map(previous.comments.map((comment) => [comment.number, comment]));
        for (const comment of result.comments) comments.set(comment.number, comment);
        result = { ...result, comments: [...comments.values()] };
      }
    }
    state = { uri, pending: false, needsRefresh, result };
    changed(state);
  };
  return { load, clear };
}

export function isConveneResourceLink(href: string): boolean {
  return href.startsWith("convene://");
}

export function resolveConveneDocumentLink(href: string, documentUri?: string): string | null {
  if (
    !documentUri?.startsWith("convene://docs/") ||
    !href ||
    href.startsWith("#") ||
    href.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(href)
  )
    return null;
  try {
    const base = new URL(documentUri);
    const path = /^(\/[^/]+\/[^/]+\/[^/]+)(\/.+)$/.exec(base.pathname);
    if (!path) return null;
    const modulePath = path[1]!;
    // A leading slash is relative to this module, not the URI authority.
    base.pathname = path[2]!;
    const resolved = new URL(href, base);
    resolved.pathname = modulePath + resolved.pathname;
    return resolved.href;
  } catch {
    return null;
  }
}
