import * as NodeVM from "node:vm";

import { describe, expect, it, vi } from "vite-plus/test";

import {
  captureGuestPage,
  routeMouseToFrame,
  sendPageCommand,
  toKeyboardInputEvents,
} from "./GuestInput.ts";

const makeGuest = ({
  focused,
  focusedDocument = true,
}: {
  readonly focused: boolean;
  readonly focusedDocument?: boolean;
}) => {
  const sendCommand = vi.fn(async (method: string, params?: { expression?: string }) =>
    method === "Runtime.evaluate" && params?.expression?.endsWith("!== null")
      ? { result: { value: focusedDocument } }
      : { result: {} },
  );
  const webContents = {
    focusedFrame: focused ? {} : null,
    insertText: vi.fn(async () => {}),
    sendInputEvent: vi.fn(),
    reload: vi.fn(),
    reloadIgnoringCache: vi.fn(),
  };
  return {
    webContents,
    sendCommand,
    send: (method: string, params: Record<string, unknown>) =>
      sendPageCommand(
        webContents as unknown as Electron.WebContents,
        { sendCommand } as unknown as Electron.Debugger,
        method,
        params,
      ),
  };
};

describe("preview guest input", () => {
  it("keeps the screenshot slot after the caller is cancelled and drops a cancelled waiter", async () => {
    const firstCapture = Promise.withResolvers<Electron.NativeImage>();
    const image = {
      isEmpty: () => false,
      toPNG: () => Buffer.from("frame"),
    } as Electron.NativeImage;
    const capturePage = vi.fn().mockReturnValueOnce(firstCapture.promise).mockResolvedValue(image);
    const guest = { capturePage } as unknown as Electron.WebContents;
    const caller = new AbortController();
    const first = captureGuestPage(guest, { signal: caller.signal });
    caller.abort();
    const queued = new AbortController();
    const abandoned = captureGuestPage(guest, { signal: queued.signal });
    const rejected = expect(abandoned).rejects.toMatchObject({ name: "AbortError" });
    queued.abort();
    const next = sendPageCommand(guest, {} as Electron.Debugger, "Page.captureScreenshot", {});
    expect(capturePage).toHaveBeenCalledTimes(1);
    firstCapture.resolve(image);
    await first;
    await rejected;
    await expect(next).resolves.toEqual({ data: Buffer.from("frame").toString("base64") });
    expect(capturePage).toHaveBeenCalledTimes(2);
  });

  it("types into an unfocused guest's own page, not the app's focused field", async () => {
    const guest = makeGuest({ focused: false });
    await guest.send("Input.insertText", { text: "pairing-code" });
    expect(guest.webContents.insertText).toHaveBeenCalledWith("pairing-code");
    expect(guest.sendCommand).not.toHaveBeenCalledWith("Input.insertText", expect.anything());
  });

  it("stops the guest navigation without stopping its embedder", async () => {
    let guestLoading = true;
    let hostLoading = true;
    const guest = {
      stop: () => {
        guestLoading = false;
      },
    };
    const debuggee = {
      sendCommand: async () => {
        hostLoading = false;
        return {};
      },
    };
    await sendPageCommand(
      guest as unknown as Electron.WebContents,
      debuggee as unknown as Electron.Debugger,
      "Page.stopLoading",
      {},
    );
    expect(guestLoading).toBe(false);
    expect(hostLoading).toBe(true);
  });

  it.each([
    {
      sessionId: undefined,
      method: "Input.dispatchMouseEvent",
      type: "mousePressed",
      outcome: "restore",
    },
    {
      sessionId: "child-frame",
      method: "Input.dispatchMouseEvent",
      type: "mousePressed",
      outcome: "restore",
    },
    {
      sessionId: undefined,
      method: "Input.dispatchTouchEvent",
      type: "touchStart",
      outcome: "restore",
    },
    {
      sessionId: undefined,
      method: "Input.dispatchMouseEvent",
      type: "mousePressed",
      outcome: "other-field",
    },
    {
      sessionId: undefined,
      method: "Input.dispatchMouseEvent",
      type: "mousePressed",
      outcome: "removed",
    },
    {
      sessionId: undefined,
      method: "Input.dispatchMouseEvent",
      type: "mousePressed",
      outcome: "failure",
    },
  ])(
    "preserves host focus for $method in $sessionId with $outcome",
    async ({ sessionId, method, type, outcome }) => {
      const document = { activeElement: {} as object };
      const composer = {
        isConnected: true,
        focus: () => {
          document.activeElement = composer;
        },
      };
      const preview = { tagName: "WEBVIEW", getWebContentsId: () => 7 };
      const otherField = { tagName: "INPUT" };
      document.activeElement = composer;
      const context = NodeVM.createContext({ document });
      const host = {
        isDestroyed: () => false,
        executeJavaScript: async (script: string) => NodeVM.runInContext(script, context),
      };
      const guest = { id: 7, focusedFrame: null, hostWebContents: host };
      const debuggee = {
        sendCommand: async () => {
          document.activeElement = outcome === "other-field" ? otherField : preview;
          if (outcome === "removed") composer.isConnected = false;
          if (outcome === "failure") throw new Error("Pointer failed");
          return {};
        },
      };
      const result = sendPageCommand(
        guest as unknown as Electron.WebContents,
        debuggee as unknown as Electron.Debugger,
        method,
        { type, x: 10, y: 10, button: "left" },
        sessionId,
      );
      if (outcome === "failure") await expect(result).rejects.toThrow("Pointer failed");
      else await result;
      expect(document.activeElement).toBe(
        outcome === "other-field" ? otherField : outcome === "removed" ? preview : composer,
      );
      expect(Object.keys(context)).toEqual(["document"]);
    },
  );

  it.each([{ userClicksStuckTab: false }, { userClicksStuckTab: true }])(
    "keeps the right focus when a sibling press finishes beside a stuck one, user clicks: $userClicksStuckTab",
    async ({ userClicksStuckTab }) => {
      const document = { activeElement: {} as object };
      const composer = {
        isConnected: true,
        focus: () => {
          document.activeElement = composer;
        },
      };
      document.activeElement = composer;
      const context = NodeVM.createContext({ document });
      const host = {
        isDestroyed: () => false,
        executeJavaScript: async (script: string) => NodeVM.runInContext(script, context),
      };
      const previews = new Map(
        [7, 8].map((id) => [id, { tagName: "WEBVIEW", getWebContentsId: () => id }]),
      );
      const stuckPressFocused = Promise.withResolvers<void>();
      const stuckPressEnds = Promise.withResolvers<void>();
      const press = (id: number) => {
        const debuggee = {
          sendCommand: async () => {
            document.activeElement = previews.get(id)!;
            if (id === 7) {
              stuckPressFocused.resolve();
              await stuckPressEnds.promise;
            } else if (userClicksStuckTab) {
              document.activeElement = previews.get(7)!;
            }
            return {};
          },
        };
        return sendPageCommand(
          { id, focusedFrame: null, hostWebContents: host } as unknown as Electron.WebContents,
          debuggee as unknown as Electron.Debugger,
          "Input.dispatchMouseEvent",
          { type: "mousePressed", x: 10, y: 10, button: "left" },
        );
      };
      // A press held open, as by a page's confirm() on mousedown, must not block or win focus.
      const stuck = press(7);
      await stuckPressFocused.promise;
      await press(8);
      const expected = userClicksStuckTab ? previews.get(7) : composer;
      expect(document.activeElement).toBe(expected);
      stuckPressEnds.resolve();
      await stuck;
      expect(Object.keys(context)).toEqual(["document"]);
    },
  );

  it.each([
    {
      method: "Input.dispatchMouseEvent",
      press: "mousePressed",
      release: "mouseReleased",
      failPress: false,
    },
    {
      method: "Input.dispatchTouchEvent",
      press: "touchStart",
      release: "touchEnd",
      failPress: false,
    },
    {
      method: "Input.dispatchMouseEvent",
      press: "mousePressed",
      release: "mouseReleased",
      failPress: true,
    },
  ])(
    "keeps $method releases behind presses waiting for host focus, failed press: $failPress",
    async ({ method, press, release, failPress }) => {
      const captureStarted = Promise.withResolvers<void>();
      const finishCapture = Promise.withResolvers<void>();
      const events: Array<unknown> = [];
      const guest = {
        id: 7,
        focusedFrame: null,
        hostWebContents: {
          isDestroyed: () => false,
          executeJavaScript: async () => {
            captureStarted.resolve();
            await finishCapture.promise;
          },
        },
      };
      const debuggee = {
        sendCommand: async (_method: string, params: Record<string, unknown>) => {
          events.push(params["type"]);
          if (failPress && params["type"] === press) throw new Error("Press failed");
          return {};
        },
      };
      const send = (type: string) =>
        sendPageCommand(
          guest as unknown as Electron.WebContents,
          debuggee as unknown as Electron.Debugger,
          method,
          { type },
        );
      const pressed = send(press);
      await captureStarted.promise;
      const released = send(release);
      finishCapture.resolve();
      const results = await Promise.allSettled([pressed, released]);
      expect(results.map((result) => result.status)).toEqual([
        failPress ? "rejected" : "fulfilled",
        "fulfilled",
      ]);
      expect(events).toEqual([press, release]);
    },
  );

  describe("mouse input over a cross-site frame of a guest the window does not show", () => {
    type Box = readonly [left: number, top: number, right: number, bottom: number];
    // Boxes are in each frame's viewport. The page is scrolled 1000px and holds a cross-site
    // frame with a 10px border and a same-site frame; the cross-site frame, scrolled 300px,
    // holds another cross-site frame.
    const documents: Record<
      string,
      {
        readonly ownFrameId: string;
        readonly scroll: { readonly pageX: number; readonly pageY: number };
        readonly owners: ReadonlyArray<{ border: Box; content: Box; frameId: string }>;
      }
    > = {
      page: {
        ownFrameId: "MAIN",
        scroll: { pageX: 0, pageY: 1000 },
        owners: [
          { border: [0, 89, 620, 409], content: [10, 99, 610, 399], frameId: "CROSS" },
          { border: [700, 0, 900, 200], content: [700, 0, 900, 200], frameId: "SAME" },
        ],
      },
      "session-cross": {
        ownFrameId: "CROSS",
        scroll: { pageX: 0, pageY: 300 },
        owners: [
          { border: [100, 100, 300, 300], content: [100, 100, 300, 300], frameId: "NESTED" },
        ],
      },
      "session-nested": { ownFrameId: "NESTED", scroll: { pageX: 0, pageY: 0 }, owners: [] },
    };
    const inside = ([left, top, right, bottom]: Box, x: number, y: number) =>
      x >= left && x < right && y >= top && y < bottom;
    const makeFramedGuest = (
      frameSessions: ReadonlyMap<string, string> = new Map([
        ["CROSS", "session-cross"],
        ["NESTED", "session-nested"],
      ]),
      unansweredLookup?: string,
    ) => {
      const input: Array<{ sessionId: string | undefined; x: unknown; y: unknown }> = [];
      const lookups: Array<{ sessionId: string | undefined; x: unknown; y: unknown }> = [];
      const sendCommand = vi.fn(
        async (method: string, params: Record<string, unknown>, sessionId?: string) => {
          const document = documents[sessionId ?? "page"]!;
          if (method === "Page.getLayoutMetrics") {
            if (sessionId !== undefined && sessionId === unansweredLookup) {
              return new Promise(() => {});
            }
            return { cssLayoutViewport: document.scroll };
          }
          if (method === "DOM.getNodeForLocation") {
            lookups.push({ sessionId, x: params["x"], y: params["y"] });
            // Chromium hit-tests in document coordinates.
            const x = (params["x"] as number) - document.scroll.pageX;
            const y = (params["y"] as number) - document.scroll.pageY;
            const index = document.owners.findIndex(({ border }) => inside(border, x, y));
            return { backendNodeId: index + 1, frameId: document.ownFrameId };
          }
          const owner = document.owners[(params["backendNodeId"] as number) - 1];
          // A miss lands on the document's root element, which names the document's own frame.
          if (method === "DOM.describeNode") {
            return { node: { frameId: owner?.frameId ?? document.ownFrameId } };
          }
          if (method === "DOM.getBoxModel") {
            const [left, top, right, bottom] = owner!.content;
            return { model: { content: [left, top, right, top, right, bottom, left, bottom] } };
          }
          input.push({ sessionId, x: params["x"], y: params["y"] });
          return {};
        },
      );
      const debuggee = { sendCommand } as unknown as Electron.Debugger;
      const send = (params: Record<string, unknown>, routed: boolean) =>
        sendPageCommand(
          {} as Electron.WebContents,
          debuggee,
          "Input.dispatchMouseEvent",
          params,
          undefined,
          routed ? routeMouseToFrame(debuggee, frameSessions, () => () => {}) : undefined,
        );
      const click = async (x: number, y: number, routed = true) => {
        for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
          await send({ type, x, y }, routed);
        }
      };
      return { click, send, input, lookups };
    };

    it("sends it to the frame under the point, at the frame's own coordinates", async () => {
      const guest = makeFramedGuest();
      await guest.click(75.4, 116.5);
      expect(guest.input).toEqual(
        Array.from({ length: 3 }, () => ({ sessionId: "session-cross", x: 65.4, y: 17.5 })),
      );
      // The lookup takes whole document pixels, so it adds each frame's scroll.
      expect(guest.lookups.slice(0, 2)).toEqual([
        { sessionId: undefined, x: 75, y: 1117 },
        { sessionId: "session-cross", x: 65, y: 318 },
      ]);
    });

    it("follows a cross-site frame inside another", async () => {
      const guest = makeFramedGuest();
      await guest.click(160, 250);
      expect(guest.input[0]).toEqual({ sessionId: "session-nested", x: 50, y: 51 });
    });

    it("keeps input over the page, a same-site frame or a frame's border on the page", async () => {
      const guest = makeFramedGuest();
      await guest.click(650, 50);
      await guest.click(750, 50);
      await guest.click(5, 95);
      expect(guest.input.map(({ sessionId }) => sessionId)).toEqual(Array(9).fill(undefined));
    });

    it("gives the page an event whose frame never answers its lookup", async () => {
      vi.useFakeTimers();
      try {
        const guest = makeFramedGuest(undefined, "session-cross");
        const stalled = guest.click(75, 116);
        await vi.advanceTimersByTimeAsync(3_000);
        await stalled;
        await guest.click(650, 50);
        expect(guest.input.map(({ sessionId }) => sessionId)).toEqual(Array(6).fill(undefined));
      } finally {
        vi.useRealTimers();
      }
    });

    it("leaves wheels, pages without cross-site frames, and shown guests to Chromium", async () => {
      const guest = makeFramedGuest();
      await guest.send({ type: "mouseWheel", x: 75, y: 116, deltaY: 100 }, true);
      await guest.click(75, 116, false);
      const bare = makeFramedGuest(new Map());
      await bare.click(75, 116);
      expect([...guest.lookups, ...bare.lookups]).toEqual([]);
      expect([...guest.input, ...bare.input].map(({ sessionId }) => sessionId)).toEqual(
        Array(7).fill(undefined),
      );
    });
  });

  it("refuses input when a cross-site frame holds the unfocused page's focus", async () => {
    const guest = makeGuest({ focused: false, focusedDocument: false });
    await expect(guest.send("Input.insertText", { text: "secret" })).rejects.toThrow(
      /cross-site frame/,
    );
    expect(guest.webContents.insertText).not.toHaveBeenCalled();
  });

  it("asks before typing into an unfocused guest, once its focus lookup has answered", async () => {
    const guest = makeGuest({ focused: false });
    let held = false;
    const type = () =>
      sendPageCommand(
        guest.webContents as unknown as Electron.WebContents,
        { sendCommand: guest.sendCommand } as unknown as Electron.Debugger,
        "Input.insertText",
        { text: "note" },
        undefined,
        undefined,
        () => {
          if (held) throw new Error("Held");
        },
      );
    const typing = type();
    // The lookup is on its way; the hold starts before it answers.
    held = true;
    await expect(typing).rejects.toThrow("Held");
    expect(guest.webContents.insertText).not.toHaveBeenCalled();
    held = false;
    await type();
    expect(guest.webContents.insertText).toHaveBeenCalledWith("note");
  });
});

describe("CDP key events as Electron input", () => {
  it("sends a key's text as char events after its key down", () => {
    expect(toKeyboardInputEvents({ type: "keyDown", key: "Enter", text: "\r" })).toEqual([
      { type: "rawKeyDown", keyCode: "Enter", modifiers: [] },
      { type: "char", keyCode: "\r", modifiers: [] },
    ]);
    expect(toKeyboardInputEvents({ type: "keyDown", key: "é", text: "é", modifiers: 8 })).toEqual([
      { type: "rawKeyDown", keyCode: "é", modifiers: ["shift"] },
      { type: "char", keyCode: "é", modifiers: ["shift"] },
    ]);
  });

  // regression: #18556 agent typing in a preview tab landed in the app instead of the guest
  it("names arrows and function keys as Electron accelerators", () => {
    expect(toKeyboardInputEvents({ type: "keyUp", key: "ArrowLeft", modifiers: 3 })).toEqual([
      { type: "keyUp", keyCode: "Left", modifiers: ["alt", "control"] },
    ]);
    expect(toKeyboardInputEvents({ type: "rawKeyDown", key: "F12" })).toEqual([
      { type: "rawKeyDown", keyCode: "F12", modifiers: [] },
    ]);
    expect(toKeyboardInputEvents({ type: "rawKeyDown", key: "AudioVolumeUp" })).toEqual([]);
  });
});

describe("desktop guest capture", () => {
  const setup = (width = 1000, height = 500) => {
    const crops: Electron.Rectangle[] = [];
    const sizes: Array<{ width: number; height: number }> = [];
    const image = (w: number, h: number): Electron.NativeImage =>
      ({
        getSize: () => ({ width: w, height: h }),
        isEmpty: () => w === 0 || h === 0,
        crop: (rect: Electron.Rectangle) => {
          crops.push(rect);
          return image(rect.width, rect.height);
        },
        resize: (size: { width: number; height: number }) => {
          sizes.push(size);
          return image(size.width, size.height);
        },
        toPNG: () => Buffer.from(`png:${w}x${h}`),
        toJPEG: (quality: number) => Buffer.from(`jpeg:${quality}:${w}x${h}`),
      }) as Electron.NativeImage;
    const capturePage = vi.fn(async () => image(width, height));
    const sendCommand = vi.fn(async (method: string) =>
      method === "Runtime.evaluate"
        ? { result: { value: 2.5 } }
        : {
            cssVisualViewport: {
              pageX: 20,
              pageY: 30,
              clientWidth: 385,
              clientHeight: 200,
              zoom: 1.25,
            },
          },
    );
    const send = (params: Record<string, unknown>) =>
      sendPageCommand(
        { capturePage } as unknown as Electron.WebContents,
        { sendCommand } as unknown as Electron.Debugger,
        "Page.captureScreenshot",
        params,
      );
    return { send, capturePage, sendCommand, crops, sizes };
  };

  it("returns native PNG pixels without forwarding the screenshot to CDP", async () => {
    const guest = setup();
    expect(await guest.send({ format: "png" })).toEqual({
      data: Buffer.from("png:1000x500").toString("base64"),
    });
    expect(guest.capturePage).toHaveBeenCalledWith(undefined, {
      stayHidden: false,
      stayAwake: true,
    });
    expect(guest.sendCommand).not.toHaveBeenCalledWith("Page.captureScreenshot", expect.anything());
  });

  it("clips and scales a scrolled page at its display ratio with zoom and a scrollbar", async () => {
    const guest = setup();
    expect(
      await guest.send({
        format: "jpeg",
        quality: 80,
        clip: { x: 50, y: 62.5, width: 100, height: 50, scale: 0.5 },
      }),
    ).toEqual({ data: Buffer.from("jpeg:80:100x50").toString("base64") });
    expect(guest.crops).toEqual([{ x: 50, y: 50, width: 200, height: 100 }]);
    expect(guest.sizes).toEqual([{ width: 100, height: 50 }]);
  });

  it("reports an empty native capture instead of returning a successful screenshot", async () => {
    await expect(setup(0, 0).send({ format: "png" })).rejects.toThrow("empty");
  });
});
