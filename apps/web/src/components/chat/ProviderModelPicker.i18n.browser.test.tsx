import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../../test/render";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";

import { changeLanguage } from "../../i18n";
import { describe, expect, it, vi } from "vite-plus/test";

import { deriveProviderInstanceEntries } from "../../providerInstances";
import { ProviderModelPicker } from "./ProviderModelPicker";
import type { ModelEsque } from "./providerIconUtils";

function providerEntry(instanceId: string, driver: string) {
  const provider: ServerProvider = {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-08-28T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
  };
  return deriveProviderInstanceEntries([provider])[0]!;
}

let root: Screen;
let container: HTMLDivElement;

async function renderPicker(input: {
  instanceId: string;
  driver: string;
  model: string | null;
  options: ReadonlyArray<ModelEsque>;
  includeEntry?: boolean;
  triggerLabel?: string;
  reportedModel?: string;
}) {
  const instanceId = ProviderInstanceId.make(input.instanceId);
  const entry = providerEntry(input.instanceId, input.driver);
  await act(async () =>
    root.rerender(
      <ProviderModelPicker
        environmentId={null}
        activeInstanceId={instanceId}
        model={input.model}
        reportedModelSelection={
          input.reportedModel ? { instanceId, model: input.reportedModel } : undefined
        }
        lockedProvider={null}
        instanceEntries={input.includeEntry === false ? [] : [entry]}
        modelOptionsByInstance={new Map([[instanceId, input.options]])}
        onInstanceModelChange={() => {}}
        {...(input.triggerLabel ? { triggerLabel: input.triggerLabel } : {})}
      />,
    ),
  );
  return container.textContent ?? "";
}

describe("ProviderModelPicker", () => {
  it.each(["codex", "claudeAgent", "cursor", "grok"])(
    "preserves a missing %s model instead of displaying an unrelated catalog model",
    async (driver) => {
      await using _lifecycle = await setupLifecycle();

      const markup = await renderPicker({
        instanceId: `${driver}_work`,
        driver,
        model: "missing-model",
        options: [{ slug: "fallback-model", name: "Fallback model" }],
      });

      expect(markup).toContain("missing-model");
      expect(markup).not.toContain("Fallback model");
    },
  );

  it("preserves the model when its instance entry is missing", async () => {
    await using _lifecycle = await setupLifecycle();

    const markup = await renderPicker({
      instanceId: "missing_instance",
      driver: "opencode",
      model: "missing-model",
      options: [{ slug: "fallback-model", name: "Fallback model" }],
      includeEntry: false,
    });

    expect(markup).toContain("missing-model");
    expect(markup).not.toContain("Fallback model");
  });
});

it("updates the native-default label in place when language changes", async () => {
  await using _lifecycle = await setupLifecycle();

  await renderPicker({
    instanceId: "codex",
    driver: "codex",
    model: null,
    options: [
      { slug: "", name: "Follow agent default" },
      { slug: "raw/custom", name: "User model" },
    ],
  });
  expect(container.textContent).toContain("Default model");
  await act(async () => changeLanguage("zh"));
  expect(container.textContent).toContain("默认模型");
  expect(container.textContent).not.toContain("User model");
  await act(async () => changeLanguage("en"));
  expect(container.textContent).toContain("Default model");
});

it("shows the resolved native default without changing its follow-default selection", async () => {
  await using _lifecycle = await setupLifecycle();

  await changeLanguage("zh");
  const text = await renderPicker({
    instanceId: "claude",
    driver: "claudeAgent",
    model: null,
    options: [
      { slug: "", name: "gateway-model" },
      { slug: "gateway-model", name: "gateway-model" },
    ],
  });
  expect(text).toContain("gateway-model · 默认");
});

it("keeps an existing session's reported model when the native default changes", async () => {
  await using _lifecycle = await setupLifecycle();

  for (const nextDefault of ["first-default", "next-default"]) {
    const text = await renderPicker({
      instanceId: "codex",
      driver: "codex",
      model: null,
      reportedModel: "session-model",
      options: [
        { slug: "", name: nextDefault },
        { slug: "session-model", name: "Session Model" },
      ],
    });
    expect(text).toContain("Session Model");
    expect(text).not.toContain(nextDefault);
  }
  const fresh = await renderPicker({
    instanceId: "codex",
    driver: "codex",
    model: null,
    options: [{ slug: "", name: "next-default" }],
  });
  expect(fresh).toContain("next-default");
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await act(async () => root.unmount());
    container.remove();
    await changeLanguage("en");
    vi.unstubAllGlobals();
  });

  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));

  renderStack = stack.move();
  return renderStack;
}
