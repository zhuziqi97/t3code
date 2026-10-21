import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../../test/render";

import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { createModelSelection, readCustomModelEntries } from "@t3tools/shared/model";

import { describe, expect, it, vi } from "vite-plus/test";

import {
  getAppModelOptionsForInstance,
  resolveAppModelSelectionForInstance,
} from "../../modelSelection";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { ProviderInstanceCard } from "./ProviderInstanceCard";
import { providerClients } from "./providerDriverMeta";

const instanceId = ProviderInstanceId.make("antigravity_work");
const driver = ProviderDriverKind.make("antigravity");
const nativeId = "gemini-3.8-flash-high";
const nativeModel: ServerProviderModel = {
  slug: nativeId,
  name: "Gemini 3.8 Flash (High)",
  isCustom: false,
  capabilities: { optionDescriptors: [] },
};
const liveProvider: ServerProvider = {
  instanceId,
  driver,
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-10T00:00:00.000Z",
  models: [nativeModel, { slug: "removed", name: "Removed", isCustom: true, capabilities: null }],
  slashCommands: [],
  skills: [],
};
const scrollIntoView = HTMLElement.prototype.scrollIntoView;

let container: HTMLDivElement;
let root: Screen;
let instance: ProviderInstanceConfig;

async function renderEditor() {
  await root.rerender(
    <ProviderInstanceCard
      instanceId={instanceId}
      instance={instance}
      driverOption={providerClients.get(driver)}
      liveProvider={liveProvider}
      mode="editor"
      onUpdate={(next) => {
        instance = JSON.parse(JSON.stringify(next)) as ProviderInstanceConfig;
        renderEditor();
      }}
      hiddenModels={[]}
      favoriteModels={[]}
      modelOrder={[]}
      onHiddenModelsChange={() => undefined}
      onFavoriteModelsChange={() => undefined}
      onToggleFavorite={() => {}}
      onModelOrderChange={() => undefined}
    />,
  );
}

async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (element) =>
      element.textContent?.trim() === label || element.getAttribute("aria-label") === label,
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}

async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function addModel(slug: string) {
  await click("Add custom model");
  await fill(
    container.querySelector<HTMLInputElement>(`#provider-instance-${instanceId}-custom-model`)!,
    slug,
  );
  await click("Add");
}

function modelRows() {
  return [...container.querySelectorAll<HTMLElement>("[data-model-slug]")];
}

function pickerOptions() {
  return getAppModelOptionsForInstance(
    { ...DEFAULT_UNIFIED_SETTINGS, providerInstances: { [instanceId]: instance } },
    deriveProviderInstanceEntries([liveProvider])[0]!,
  );
}

describe("Antigravity custom models in settings and selectors", () => {
  it("keeps saved entries when adding another model and reloading the settings editor", async () => {
    await using _lifecycle = await setupLifecycle();

    instance = { driver, config: { customModels: ["manual-one"] } };
    await act(async () => renderEditor());
    expect(modelRows().map((row) => row.dataset.modelSlug)).toEqual([nativeId, "manual-one"]);

    await addModel("manual-two");
    const saved = readCustomModelEntries((instance.config as Record<string, unknown>).customModels);
    expect(saved.map((model) => model.slug)).toEqual(["manual-one", "manual-two"]);

    await act(async () => root.unmount());
    root = renderStack.use(await renderTestUi(null, { container: container, router: false }));
    await act(async () => renderEditor());
    expect(modelRows().map((row) => row.dataset.modelSlug)).toEqual([
      nativeId,
      "manual-one",
      "manual-two",
    ]);
    expect(
      pickerOptions()
        .filter((model) => model.isCustom)
        .map((model) => model.slug),
    ).toEqual(["manual-one", "manual-two"]);
  });

  it("merges a name override without changing the native ID and restores the native row on removal", async () => {
    await using _lifecycle = await setupLifecycle();

    instance = { driver, config: { customModels: [] } };
    await act(async () => renderEditor());
    await addModel(nativeId);
    const nameInput = container.querySelector<HTMLInputElement>(
      `#provider-instance-${instanceId}-custom-model-name`,
    )!;
    await fill(nameInput, "My thinking model");
    await click("Save");
    expect(modelRows()).toHaveLength(1);
    expect(modelRows()[0]!.textContent).toContain("My thinking model");
    const selected = pickerOptions().find((model) => model.slug === nativeId)!;
    expect(selected.name).toBe("My thinking model");
    const selection = createModelSelection(instanceId, selected.slug);
    expect(selection).toEqual({ instanceId, model: nativeId });
    expect(
      resolveAppModelSelectionForInstance(
        instanceId,
        { ...DEFAULT_UNIFIED_SETTINGS, providerInstances: { [instanceId]: instance } },
        [liveProvider],
        selection.model,
      ),
    ).toBe(nativeId);

    await click(`Remove ${nativeId}`);
    expect(modelRows()).toHaveLength(1);
    expect(modelRows()[0]!.textContent).toContain(nativeModel.name);
    expect(pickerOptions().find((model) => model.slug === nativeId)?.name).toBe(nativeModel.name);
  });
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await act(async () => root.unmount());
    container.remove();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  vi.stubGlobal("CSS", { escape: (value: string) => value });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));

  renderStack = stack.move();
  return renderStack;
}
