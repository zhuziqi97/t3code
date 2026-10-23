import { describe, expect, it } from "vite-plus/test";

import { deriveWsBaseUrl, normalizeHttpBaseUrl, environmentEndpointUrl } from "./endpoint.ts";

describe("advertised endpoint helpers", () => {
  it("keeps a mounted environment path when resolving native endpoints", () => {
    expect(
      environmentEndpointUrl(
        "https://convene.test/client-web/one/?old=1#thread",
        "/api/auth/session",
      ),
    ).toBe("https://convene.test/client-web/one/api/auth/session");
  });
  it("normalizes HTTP and WebSocket base URLs", () => {
    expect(normalizeHttpBaseUrl("https://example.com/path?x=1#hash")).toBe("https://example.com/");
    expect(normalizeHttpBaseUrl("wss://example.com/socket")).toBe("https://example.com/");
    expect(deriveWsBaseUrl("https://example.com/api")).toBe("wss://example.com/");
    expect(deriveWsBaseUrl("http://127.0.0.1:3773")).toBe("ws://127.0.0.1:3773/");
  });
});
