/**
 * Keyboard and text input for a preview tab's page that never lands outside it.
 *
 * Chromium sends a page's CDP key and text input to whichever frame holds focus
 * in the window. A `<webview>` guest shares that focus with the app around it,
 * so while a person works in the app, `Input.insertText` on the guest's own
 * debugger types into the app's focused field. Such input goes through CDP only
 * while the guest holds focus. Otherwise it goes straight to the guest's own
 * widget, which nothing redirects.
 */

/** CDP input Chromium delivers to the window's focused frame rather than the page's. */
const FOCUS_ROUTED_INPUT = new Set([
  "Input.insertText",
  "Input.dispatchKeyEvent",
  "Input.imeSetComposition",
]);

/**
 * Page script: the document holding the page's focus, or null when a cross-site
 * frame holds it. Electron's direct input reaches only the main frame's process,
 * and `insertText` crashes the page when focus is in another one.
 */
const FOCUSED_DOCUMENT = `(() => {
  let doc = document;
  for (;;) {
    const active = doc.activeElement;
    if (active?.tagName !== "IFRAME" && active?.tagName !== "FRAME") return doc;
    if (!active.contentDocument) return null;
    doc = active.contentDocument;
  }
})()`;

/**
 * macOS editing commands a key press asks for (Cmd+A is `selectAll`), which
 * Chromium runs only for CDP keys. Clipboard commands stay out: they would read
 * or replace the person's clipboard.
 */
const EDITING_COMMANDS = new Set(["selectAll", "undo", "redo"]);

const CROSS_SITE_FOCUS_MESSAGE =
  "The page's focus is inside a cross-site frame, which takes typed input only while the preview has focus. Click the field first.";

const ARROW_KEYS: Record<string, string> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};
const NAMED_KEYS = new Set([
  "Backspace",
  "Tab",
  "Enter",
  "Escape",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "PrintScreen",
]);
const MODIFIER_BITS = [
  [1, "alt"],
  [2, "control"],
  [4, "meta"],
  [8, "shift"],
] as const;

/** Electron's accelerator name for a DOM key value, or null when it has none. */
const keyCodeFor = (key: string) => {
  if ([...key].length === 1) return key;
  if (ARROW_KEYS[key]) return ARROW_KEYS[key];
  return NAMED_KEYS.has(key) || /^F(?:[1-9]|1\d|2[0-4])$/u.test(key) ? key : null;
};

/**
 * The Electron key events for one CDP `Input.dispatchKeyEvent`. Electron
 * derives key, code, and a char's text from `keyCode`, so typed text travels
 * as `char` events of its own.
 */
export const toKeyboardInputEvents = (
  params: Record<string, unknown>,
): Array<Electron.KeyboardInputEvent> => {
  const bits = typeof params["modifiers"] === "number" ? params["modifiers"] : 0;
  const modifiers = MODIFIER_BITS.flatMap(([bit, name]) => (bits & bit ? [name] : []));
  const text = typeof params["text"] === "string" ? params["text"] : "";
  const chars = [...text].map((char) => ({ type: "char" as const, keyCode: char, modifiers }));
  const keyCode = keyCodeFor(typeof params["key"] === "string" ? params["key"] : "");
  switch (params["type"]) {
    case "keyDown":
      return [...(keyCode ? [{ type: "rawKeyDown" as const, keyCode, modifiers }] : []), ...chars];
    case "rawKeyDown":
    case "keyUp":
      return keyCode ? [{ type: params["type"], keyCode, modifiers }] : [];
    case "char":
      return chars;
    default:
      return [];
  }
};

const evaluate = async (debuggee: Electron.Debugger, expression: string) => {
  const reply = (await debuggee.sendCommand("Runtime.evaluate", {
    expression,
    returnByValue: true,
  })) as { readonly result?: { readonly value?: unknown } };
  return reply.result?.value;
};

interface ScreenshotClip {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
}

const captureScreenshot = async (
  webContents: Electron.WebContents,
  debuggee: Electron.Debugger,
  params: Record<string, unknown>,
) => {
  const clip = params["clip"] as ScreenshotClip | undefined;
  const metrics = clip
    ? ((await debuggee.sendCommand("Page.getLayoutMetrics")) as {
        readonly cssVisualViewport: {
          readonly pageX: number;
          readonly pageY: number;
          readonly zoom?: number;
        };
      })
    : undefined;
  // CDP waits forever for a hidden webview's surface. A native capturer marks
  // only the guest page visible while copying pixels; its window stays hidden.
  let image = await webContents.capturePage(undefined, { stayHidden: false, stayAwake: true });
  if (image.isEmpty()) throw new Error("The desktop browser returned an empty screenshot.");
  if (clip && metrics) {
    const viewport = metrics.cssVisualViewport;
    const zoom = viewport.zoom ?? 1;
    // CDP clips use document DIP; the display ratio includes page zoom. Deriving
    // it from viewport width would overcount pixels when a scrollbar is present.
    const pixelsPerDip = ((await evaluate(debuggee, "devicePixelRatio")) as number) / zoom;
    image = image.crop({
      x: Math.round((clip.x - viewport.pageX * zoom) * pixelsPerDip),
      y: Math.round((clip.y - viewport.pageY * zoom) * pixelsPerDip),
      width: Math.round(clip.width * pixelsPerDip),
      height: Math.round(clip.height * pixelsPerDip),
    });
    if (clip.scale !== 1) {
      const size = image.getSize();
      image = image.resize({
        width: Math.max(1, Math.round(size.width * clip.scale)),
        height: Math.max(1, Math.round(size.height * clip.scale)),
      });
    }
  }
  const bytes =
    params["format"] === "jpeg"
      ? image.toJPEG(typeof params["quality"] === "number" ? params["quality"] : 80)
      : image.toPNG();
  return { data: bytes.toString("base64") };
};

/** Sends one command to the guest's page, keeping reloads and input inside it. */
export const sendPageCommand = async (
  webContents: Electron.WebContents,
  debuggee: Electron.Debugger,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> => {
  if (method === "Page.captureScreenshot") return captureScreenshot(webContents, debuggee, params);
  // Electron's debugger routes Page.reload on a webview to its embedder window.
  if (method === "Page.reload") {
    if (params["ignoreCache"] === true) webContents.reloadIgnoringCache();
    else webContents.reload();
    return {};
  }
  if (!FOCUS_ROUTED_INPUT.has(method) || webContents.focusedFrame) {
    return debuggee.sendCommand(method, params);
  }
  if ((await evaluate(debuggee, `${FOCUSED_DOCUMENT} !== null`)) !== true) {
    throw new Error(CROSS_SITE_FOCUS_MESSAGE);
  }
  switch (method) {
    case "Input.insertText":
      await webContents.insertText(typeof params["text"] === "string" ? params["text"] : "");
      return {};
    case "Input.dispatchKeyEvent": {
      for (const event of toKeyboardInputEvents(params)) webContents.sendInputEvent(event);
      const commands = Array.isArray(params["commands"])
        ? params["commands"].filter((command) => EDITING_COMMANDS.has(command))
        : [];
      // Runs after the page handles the keys, so the reply also waits for them.
      await evaluate(
        debuggee,
        `(() => { const doc = ${FOCUSED_DOCUMENT}; for (const name of ${JSON.stringify(commands)}) doc?.execCommand(name); return 0; })()`,
      );
      return {};
    }
    default:
      throw new Error(`${method} needs the preview to have focus.`);
  }
};
