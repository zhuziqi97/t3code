// @vitest-environment jsdom
import {
  ANTIGRAVITY_DEFAULT_MODEL,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { changeLanguage } from "../../i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
  vi.unstubAllGlobals();
});
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
    root.render(
      <ProviderModelPicker
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
  it("shows a neutral aggregate value without a representative model or availability badge", async () => {
    const markup = await renderPicker({
      instanceId: "codex_personal",
      driver: "codex",
      model: "gpt-5",
      options: [{ slug: "gpt-5", name: "GPT 5", isUnavailable: true }],
      triggerLabel: "Mixed values",
    });
    expect(markup).toContain("Mixed values");
    expect(markup).not.toContain("GPT 5");
    expect(markup).not.toContain("Unavailable");
  });

  it.each(["", ANTIGRAVITY_DEFAULT_MODEL])(
    "shows a choice prompt before Antigravity has an account catalog for %s",
    async (model) => {
      const markup = await renderPicker({
        instanceId: "antigravity",
        driver: "antigravity",
        model,
        options: [],
      });

      expect(markup).toContain(model === "" ? "Follow agent default" : "Choose model");
      expect(markup).not.toContain(ANTIGRAVITY_DEFAULT_MODEL);
    },
  );

  it.each([{ aliases: [ANTIGRAVITY_DEFAULT_MODEL] }, { isDefault: true }])(
    "shows the actual default model for an Antigravity marker with %j",
    async (defaultMetadata) => {
      const markup = await renderPicker({
        instanceId: "google_work",
        driver: "antigravity",
        model: ANTIGRAVITY_DEFAULT_MODEL,
        options: [
          { slug: "gemini-fast", name: "Gemini Fast" },
          { slug: "gemini-pro", name: "Gemini Pro", ...defaultMetadata },
        ],
      });

      expect(markup).toContain("Gemini Pro");
      expect(markup).not.toContain("Gemini Fast");
      expect(markup).not.toContain(ANTIGRAVITY_DEFAULT_MODEL);
    },
  );

  it.each(["opencode", "antigravity"])(
    "keeps the selected model label when the %s account catalog does not contain it",
    async (driver) => {
      const markup = await renderPicker({
        instanceId: "team_runtime",
        driver,
        model: "missing-model",
        options: [{ slug: "fallback", name: "Fallback model" }],
      });

      expect(markup).toContain("missing-model");
      expect(markup).not.toContain("Fallback model");
    },
  );

  it.each(["codex", "claudeAgent", "cursor", "grok"])(
    "preserves a missing %s model instead of displaying an unrelated catalog model",
    async (driver) => {
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

  it("prefers a matching model for OpenCode", async () => {
    const markup = await renderPicker({
      instanceId: "custom_runtime",
      driver: "opencode",
      model: "openrouter/selected",
      options: [
        { slug: "openrouter/fallback", name: "Fallback model" },
        { slug: "openrouter/selected", name: "Selected model" },
      ],
    });

    expect(markup).toContain("Selected model");
    expect(markup).not.toContain("Fallback model");
  });

  it("preserves the model when its instance entry is missing", async () => {
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

  it("keeps instance initials visible in the resting trigger", async () => {
    const activeEntry = providerEntry("codex_personal", "codex");
    await act(async () =>
      root.render(
        <ProviderModelPicker
          activeInstanceId={activeEntry.instanceId}
          model="gpt-5"
          lockedProvider={null}
          instanceEntries={[providerEntry("codex", "codex"), activeEntry]}
          modelOptionsByInstance={new Map()}
          size="xs"
          onInstanceModelChange={() => {}}
        />,
      ),
    );

    expect(container.textContent).toContain("CP");
  });
});

it("updates the native-default label in place when language changes", async () => {
  await renderPicker({
    instanceId: "codex",
    driver: "codex",
    model: null,
    options: [
      { slug: "", name: "Follow agent default" },
      { slug: "raw/custom", name: "User model" },
    ],
  });
  expect(container.textContent).toContain("Follow agent default");
  await act(async () => changeLanguage("zh"));
  expect(container.textContent).toContain("跟随 Agent 默认模型");
  expect(container.textContent).not.toContain("User model");
  await act(async () => changeLanguage("en"));
  expect(container.textContent).toContain("Follow agent default");
});

it("shows the resolved native default without changing its follow-default selection", async () => {
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
  expect(text).toContain("gateway-model · 跟随默认");
});

it("keeps an existing session's reported model when the native default changes", async () => {
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
