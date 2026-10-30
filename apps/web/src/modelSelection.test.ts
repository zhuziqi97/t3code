import {
  ANTIGRAVITY_DEFAULT_MODEL,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts/settings";
import { describe, expect, it } from "vite-plus/test";
import { createModelSelection } from "@t3tools/shared/model";
import { deriveEffectiveComposerModelState } from "./composerDraftStore";
import { getComposerProviderState } from "./components/chat/composerProviderState";
import { deriveProviderInstanceEntries } from "./providerInstances";
import {
  getCustomModelOptionsByInstance as getAllCustomModelOptionsByInstance,
  getAppModelOptionsForInstance as getAllAppModelOptionsForInstance,
  resolveAppModelSelectionForInstance,
  resolveAppModelSelectionState,
  resolveEffectiveDefaultModelSelection,
} from "./modelSelection";

const getAppModelOptionsForInstance = getAllAppModelOptionsForInstance;

const getCustomModelOptionsByInstance = getAllCustomModelOptionsByInstance;

function provider(input: {
  provider?: ProviderDriverKind;
  instanceId: string;
  models?: ReadonlyArray<string>;
  supportsTextGeneration?: boolean;
}): ServerProvider {
  const driver =
    input.provider ??
    (input.instanceId.startsWith("claude_")
      ? ProviderDriverKind.make("claudeAgent")
      : ProviderDriverKind.make("codex"));
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver,
    ...(input.supportsTextGeneration === undefined
      ? {}
      : { supportsTextGeneration: input.supportsTextGeneration }),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: (input.models ?? []).map((slug) => ({
      slug,
      name: slug,
      isCustom: false,
      capabilities: {},
    })),
    slashCommands: [],
    skills: [],
  };
}

function settingsWithProviderInstances(): UnifiedSettings {
  return {
    ...DEFAULT_UNIFIED_SETTINGS,
    providerInstances: {
      [ProviderInstanceId.make("claudeAgent")]: {
        driver: ProviderDriverKind.make("claudeAgent"),
        config: { customModels: [] },
      },
      [ProviderInstanceId.make("claude_openrouter")]: {
        driver: ProviderDriverKind.make("claudeAgent"),
        config: { customModels: ["openai/gpt-5.5"] },
      },
    },
  };
}

describe("instance-scoped model selection", () => {
  it("keeps custom models on the provider instance that declared them", () => {
    const providers = [
      provider({
        instanceId: "claudeAgent",
        models: ["claude-sonnet-4-6"],
      }),
      provider({
        instanceId: "claude_openrouter",
        models: ["claude-sonnet-4-6"],
      }),
    ];
    const entries = deriveProviderInstanceEntries(providers);
    const stock = entries.find((entry) => entry.instanceId === "claudeAgent")!;
    const openrouter = entries.find((entry) => entry.instanceId === "claude_openrouter")!;

    expect(
      getAppModelOptionsForInstance(settingsWithProviderInstances(), stock).map(
        (option) => option.slug,
      ),
    ).not.toContain("openai/gpt-5.5");
    expect(
      getAppModelOptionsForInstance(settingsWithProviderInstances(), openrouter).map(
        (option) => option.slug,
      ),
    ).toContain("openai/gpt-5.5");
  });

  it("preserves a custom slug that collides with a provider alias", () => {
    const providers = [
      provider({
        provider: ProviderDriverKind.make("claudeAgent"),
        instanceId: "claude_openrouter",
        models: ["claude-opus-4-8"],
      }),
    ];
    const settings: UnifiedSettings = {
      ...settingsWithProviderInstances(),
      providerInstances: {
        ...settingsWithProviderInstances().providerInstances,
        [ProviderInstanceId.make("claude_openrouter")]: {
          driver: ProviderDriverKind.make("claudeAgent"),
          config: { customModels: ["opus"] },
        },
      },
    };
    const openrouter = deriveProviderInstanceEntries(providers)[0]!;

    expect(
      getAppModelOptionsForInstance(settings, openrouter).map((option) => option.slug),
    ).toEqual(["claude-opus-4-8", "opus"]);
    expect(
      resolveAppModelSelectionForInstance(
        ProviderInstanceId.make("claude_openrouter"),
        settings,
        providers,
        "opus",
      ),
    ).toBe("opus");
  });

  it("offers and resolves every saved custom model, past the first 32", () => {
    const providers = [
      provider({
        provider: ProviderDriverKind.make("claudeAgent"),
        instanceId: "claude_openrouter",
      }),
    ];
    const customModels = Array.from({ length: 40 }, (_, index) => `proxy/model-${index + 1}`);
    const settings: UnifiedSettings = {
      ...settingsWithProviderInstances(),
      providerInstances: {
        ...settingsWithProviderInstances().providerInstances,
        [ProviderInstanceId.make("claude_openrouter")]: {
          driver: ProviderDriverKind.make("claudeAgent"),
          config: { customModels },
        },
      },
    };
    const openrouter = deriveProviderInstanceEntries(providers)[0]!;

    expect(
      getAppModelOptionsForInstance(settings, openrouter).map((option) => option.slug),
    ).toEqual(customModels);
    expect(
      resolveAppModelSelectionForInstance(
        ProviderInstanceId.make("claude_openrouter"),
        settings,
        providers,
        "proxy/model-40",
      ),
    ).toBe("proxy/model-40");
  });

  it("drops server-reported custom rows that are no longer in settings", () => {
    const baseProvider = provider({
      instanceId: "claude_openrouter",
      models: ["claude-sonnet-4-6"],
    });
    const providers = [
      {
        ...baseProvider,
        models: [
          ...baseProvider.models,
          { slug: "removed/custom", name: "removed/custom", isCustom: true, capabilities: {} },
        ],
      },
    ];
    const openrouter = deriveProviderInstanceEntries(providers)[0]!;

    expect(
      getAppModelOptionsForInstance(settingsWithProviderInstances(), openrouter).map(
        (option) => option.slug,
      ),
    ).toEqual(["claude-sonnet-4-6", "openai/gpt-5.5"]);
  });

  it("applies persisted per-instance model ordering", () => {
    const providers = [
      provider({
        instanceId: "claudeAgent",
        models: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
      }),
    ];
    const settings: UnifiedSettings = {
      ...settingsWithProviderInstances(),
      providerModelPreferences: {
        [ProviderInstanceId.make("claudeAgent")]: {
          hiddenModels: [],
          modelOrder: ["claude-haiku-4-5", "claude-opus-4-6"],
        },
      },
    };
    const stock = deriveProviderInstanceEntries(providers).find(
      (entry) => entry.instanceId === "claudeAgent",
    )!;

    expect(getAppModelOptionsForInstance(settings, stock).map((option) => option.slug)).toEqual([
      "claude-haiku-4-5",
      "claude-opus-4-6",
      "claude-sonnet-4-6",
    ]);
  });

  it("preserves the selected ID when its picker row is hidden", () => {
    const providers = [
      provider({
        instanceId: "claudeAgent",
        models: ["claude-opus-4-6", "claude-sonnet-4-6"],
      }),
    ];
    const settings: UnifiedSettings = {
      ...settingsWithProviderInstances(),
      providerModelPreferences: {
        [ProviderInstanceId.make("claudeAgent")]: {
          hiddenModels: ["claude-opus-4-6"],
          modelOrder: [],
        },
      },
    };

    expect(
      resolveAppModelSelectionForInstance(
        ProviderInstanceId.make("claudeAgent"),
        settings,
        providers,
        "claude-opus-4-6",
      ),
    ).toBe("claude-opus-4-6");
    expect(
      resolveAppModelSelectionForInstance(
        ProviderInstanceId.make("claudeAgent"),
        settings,
        providers,
        "claude-opus-4-6",
        { preserveUnavailableSelection: true },
      ),
    ).toBe("claude-opus-4-6");
  });

  it("keeps a custom slug without resolving it against the wrong instance instead of resolving a custom slug against the wrong instance", () => {
    const providers = [
      provider({
        instanceId: "claudeAgent",
        models: ["claude-sonnet-4-6"],
      }),
      provider({
        instanceId: "claude_openrouter",
        models: ["claude-sonnet-4-6"],
      }),
    ];

    expect(
      resolveAppModelSelectionForInstance(
        ProviderInstanceId.make("claudeAgent"),
        settingsWithProviderInstances(),
        providers,
        "openai/gpt-5.5",
      ),
    ).toBe("openai/gpt-5.5");
  });

  describe.each([
    {
      driverName: "opencode",
      availableModel: "opencode/big-pickle",
      missingModel: "opencode/kimi-k3",
    },
    {
      driverName: "antigravity",
      availableModel: "gemini-3.1-pro",
      missingModel: "gemini-3.1-pro-high",
    },
  ])("$driverName catalog gaps", ({ driverName, availableModel, missingModel }) => {
    it("preserves a selected model when a catalog refresh no longer contains it", () => {
      const providers = [
        provider({
          provider: ProviderDriverKind.make(driverName),
          instanceId: driverName,
          models: [availableModel],
        }),
      ];

      expect(
        resolveAppModelSelectionForInstance(
          ProviderInstanceId.make(driverName),
          settingsWithProviderInstances(),
          providers,
          missingModel,
          { preserveUnavailableSelection: true },
        ),
      ).toBe(missingModel);
      expect(
        resolveAppModelSelectionForInstance(
          ProviderInstanceId.make(driverName),
          settingsWithProviderInstances(),
          providers,
          missingModel,
        ),
      ).toBe(missingModel);
    });

    it("adds the selected missing model as an unavailable option", () => {
      const providers = [
        provider({
          provider: ProviderDriverKind.make(driverName),
          instanceId: driverName,
          models: [availableModel],
        }),
      ];
      const entry = deriveProviderInstanceEntries(providers)[0]!;

      expect(
        getAppModelOptionsForInstance(settingsWithProviderInstances(), entry, missingModel),
      ).toEqual([
        expect.objectContaining({ slug: availableModel }),
        expect.objectContaining({
          slug: missingModel,
          name: missingModel,
        }),
      ]);
    });

    it("keeps a missing option scoped to the selected instance", () => {
      const selectedInstanceId = ProviderInstanceId.make(`${driverName}_work`);
      const otherInstanceId = ProviderInstanceId.make(`${driverName}_personal`);
      const driver = ProviderDriverKind.make(driverName);
      const providers = [
        provider({ provider: driver, instanceId: selectedInstanceId, models: [] }),
        provider({ provider: driver, instanceId: otherInstanceId, models: [] }),
      ];
      const options = getCustomModelOptionsByInstance(
        settingsWithProviderInstances(),
        providers,
        selectedInstanceId,
        missingModel,
      );

      expect(options.get(selectedInstanceId)).toEqual([
        expect.objectContaining({ slug: missingModel }),
      ]);
      expect(options.get(otherInstanceId)).toEqual([]);
    });

    it("replaces the unavailable marker with catalog metadata after recovery", () => {
      const instanceId = ProviderInstanceId.make(driverName);
      const driver = ProviderDriverKind.make(driverName);
      const selectedModel = missingModel;
      const pendingProviders = [
        provider({ provider: driver, instanceId, models: [availableModel] }),
      ];
      const recoveredProviders = [
        provider({ provider: driver, instanceId, models: [availableModel, selectedModel] }),
      ];

      expect(
        getAppModelOptionsForInstance(
          settingsWithProviderInstances(),
          deriveProviderInstanceEntries(pendingProviders)[0]!,
          selectedModel,
        ).find((option) => option.slug === selectedModel)?.isUnavailable,
      ).toBe(true);
      expect(
        getAppModelOptionsForInstance(
          settingsWithProviderInstances(),
          deriveProviderInstanceEntries(recoveredProviders)[0]!,
          selectedModel,
        ).find((option) => option.slug === selectedModel)?.isUnavailable,
      ).toBeUndefined();
      expect(
        resolveAppModelSelectionForInstance(
          instanceId,
          settingsWithProviderInstances(),
          recoveredProviders,
          selectedModel,
          { preserveUnavailableSelection: true },
        ),
      ).toBe(selectedModel);
    });

    it("does not resurrect a hidden model when the raw catalog omits it", () => {
      const instanceId = ProviderInstanceId.make(driverName);
      const driver = ProviderDriverKind.make(driverName);
      const settings: UnifiedSettings = {
        ...settingsWithProviderInstances(),
        providerModelPreferences: {
          [instanceId]: {
            hiddenModels: [missingModel],
            modelOrder: [],
          },
        },
      };
      const providers = [provider({ provider: driver, instanceId, models: [] })];
      const entry = deriveProviderInstanceEntries(providers)[0]!;

      expect(getAppModelOptionsForInstance(settings, entry, missingModel)).toEqual([]);
      expect(
        resolveAppModelSelectionForInstance(instanceId, settings, providers, missingModel, {
          preserveUnavailableSelection: true,
        }),
      ).toBe(missingModel);
    });
  });

  it("does not add unavailable options for other providers", () => {
    const providers = [
      provider({
        provider: ProviderDriverKind.make("codex"),
        instanceId: "codex",
        models: ["gpt-5.6-sol"],
      }),
    ];
    const entry = deriveProviderInstanceEntries(providers)[0]!;

    expect(
      getAppModelOptionsForInstance(settingsWithProviderInstances(), entry, "gpt-missing").map(
        (option) => option.slug,
      ),
    ).toEqual(["gpt-5.6-sol", "gpt-missing"]);
    expect(
      resolveAppModelSelectionForInstance(
        ProviderInstanceId.make("codex"),
        settingsWithProviderInstances(),
        providers,
        "gpt-missing",
        { preserveUnavailableSelection: true },
      ),
    ).toBe("gpt-missing");
  });

  it("preserves an explicit draft model absent from the directory", () => {
    const instanceId = ProviderInstanceId.make("codex");
    const driver = ProviderDriverKind.make("codex");
    const providers = [provider({ provider: driver, instanceId, models: ["gpt-5.6-sol"] })];
    const state = deriveEffectiveComposerModelState({
      draft: {
        activeProvider: instanceId,
        modelSelectionByProvider: {
          [instanceId]: createModelSelection(instanceId, "gpt-missing", [
            { id: "effort", value: "max" },
          ]),
        },
      },
      providers,
      selectedProvider: driver,
      selectedInstanceId: instanceId,
      threadModelSelection: null,
      projectModelSelection: null,
      settings: settingsWithProviderInstances(),
    });
    const dispatch = getComposerProviderState({
      provider: driver,
      model: state.selectedModel,
      models: providers[0]!.models,
      modelOptions: state.modelOptions?.[instanceId],
      planModeEnabled: false,
    });

    expect(state.selectedModel).toBe("gpt-missing");
    expect(dispatch.modelOptionsForDispatch).toEqual([{ id: "effort", value: "max" }]);
  });

  it("preserves an explicit draft OpenCode selection while the catalog is empty", () => {
    const instanceId = ProviderInstanceId.make("opencode_work");
    const driver = ProviderDriverKind.make("opencode");
    const draftSelection = createModelSelection(instanceId, "openrouter/kimi-k3", [
      { id: "variant", value: "max" },
      { id: "agent", value: "build" },
    ]);
    const providers = [provider({ provider: driver, instanceId, models: [] })];
    const state = deriveEffectiveComposerModelState({
      draft: {
        activeProvider: instanceId,
        modelSelectionByProvider: { [instanceId]: draftSelection },
      },
      providers,
      selectedProvider: driver,
      selectedInstanceId: instanceId,
      threadModelSelection: null,
      projectModelSelection: null,
      settings: settingsWithProviderInstances(),
    });

    expect(state.selectedModel).toBe("openrouter/kimi-k3");
    expect(state.modelOptions?.[instanceId]).toEqual(draftSelection.options);
  });

  it("preserves the Antigravity model in drafts and existing threads after sign-out", () => {
    const instanceId = ProviderInstanceId.make("antigravity_work");
    const driver = ProviderDriverKind.make("antigravity");
    const saved = createModelSelection(instanceId, "gemini-3.1-pro-high");
    const providers = [
      {
        ...provider({ provider: driver, instanceId, models: [] }),
        status: "error" as const,
        auth: { status: "unauthenticated" as const },
      },
    ];
    for (const draft of [
      null,
      { activeProvider: instanceId, modelSelectionByProvider: { [instanceId]: saved } },
    ]) {
      const state = deriveEffectiveComposerModelState({
        draft,
        providers,
        selectedProvider: driver,
        selectedInstanceId: instanceId,
        threadModelSelection: saved,
        projectModelSelection: null,
        settings: settingsWithProviderInstances(),
      });
      expect(state.selectedModel).toBe(saved.model);
    }
  });

  it("does not borrow a default model while a new Antigravity account has no catalog", () => {
    const driver = ProviderDriverKind.make("antigravity");
    const instanceId = ProviderInstanceId.make("antigravity_work");
    const providers = [
      provider({ instanceId: "codex", models: ["gpt-5.6-sol"] }),
      provider({ provider: driver, instanceId: "antigravity", models: ["gemini-other-account"] }),
      provider({ provider: driver, instanceId, models: [] }),
    ];

    const otherAccountId = ProviderInstanceId.make("antigravity");
    for (const draft of [
      null,
      {
        activeProvider: instanceId,
        modelSelectionByProvider: {
          [otherAccountId]: createModelSelection(otherAccountId, "gemini-other-account"),
        },
      },
    ]) {
      const state = deriveEffectiveComposerModelState({
        draft,
        providers,
        selectedProvider: driver,
        selectedInstanceId: instanceId,
        threadModelSelection: null,
        projectModelSelection: createModelSelection(
          ProviderInstanceId.make("codex"),
          "gpt-5.6-sol",
        ),
        settings: settingsWithProviderInstances(),
      });
      expect(state.selectedModel).toBe("");
    }
  });

  it("offers persisted Antigravity custom models only on their configured instance", () => {
    const driver = ProviderDriverKind.make("antigravity");
    const customId = ProviderInstanceId.make("antigravity_work");
    const nativeModel = "gemini-3.1-pro";
    const settings: UnifiedSettings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providerInstances: {
        [ProviderInstanceId.make("antigravity")]: {
          driver,
          config: { customModels: ["api-only-model"] },
        },
        [customId]: { driver, config: { customModels: ["unknown-model"] } },
      },
    };
    const entries = deriveProviderInstanceEntries([
      provider({ provider: driver, instanceId: "antigravity", models: [nativeModel] }),
      provider({ provider: driver, instanceId: customId, models: [nativeModel] }),
    ]);

    const reloaded = JSON.parse(JSON.stringify(settings)) as UnifiedSettings;
    expect(getAppModelOptionsForInstance(reloaded, entries[0]!).map((model) => model.slug)).toEqual(
      [nativeModel, "api-only-model"],
    );
    expect(getAppModelOptionsForInstance(reloaded, entries[1]!).map((model) => model.slug)).toEqual(
      [nativeModel, "unknown-model"],
    );
  });

  it("resolves the Antigravity default marker without creating an unavailable model", () => {
    const instanceId = ProviderInstanceId.make("antigravity_work");
    const nativeModel = "gemini-3.1-pro";
    const base = provider({
      provider: ProviderDriverKind.make("antigravity"),
      instanceId,
      models: [nativeModel],
    });
    const liveProvider = {
      ...base,
      models: base.models.map((model) => ({
        ...model,
        isDefault: true,
        aliases: [ANTIGRAVITY_DEFAULT_MODEL],
      })),
    };
    const settings = settingsWithProviderInstances();

    expect(
      getAppModelOptionsForInstance(
        settings,
        deriveProviderInstanceEntries([liveProvider])[0]!,
        ANTIGRAVITY_DEFAULT_MODEL,
      ).map((model) => model.slug),
    ).toEqual([nativeModel, ANTIGRAVITY_DEFAULT_MODEL]);
    expect(
      resolveAppModelSelectionForInstance(
        instanceId,
        settings,
        [liveProvider],
        ANTIGRAVITY_DEFAULT_MODEL,
        {
          preserveUnavailableSelection: true,
        },
      ),
    ).toBe(ANTIGRAVITY_DEFAULT_MODEL);

    const hiddenSettings: UnifiedSettings = {
      ...settings,
      providerModelPreferences: {
        [instanceId]: { hiddenModels: [nativeModel], modelOrder: [] },
      },
    };
    expect(
      resolveAppModelSelectionForInstance(
        instanceId,
        hiddenSettings,
        [liveProvider],
        ANTIGRAVITY_DEFAULT_MODEL,
        { preserveUnavailableSelection: true },
      ),
    ).toBe(ANTIGRAVITY_DEFAULT_MODEL);
    expect(
      getAppModelOptionsForInstance(
        settings,
        deriveProviderInstanceEntries([{ ...base, models: [] }])[0]!,
        ANTIGRAVITY_DEFAULT_MODEL,
      ),
    ).toEqual([
      { slug: ANTIGRAVITY_DEFAULT_MODEL, name: ANTIGRAVITY_DEFAULT_MODEL, isCustom: false },
    ]);
  });

  it("preserves saved options through dispatch when the model is absent from the catalog", () => {
    const instanceId = ProviderInstanceId.make("opencode");
    const driver = ProviderDriverKind.make("opencode");
    const providers = [provider({ provider: driver, instanceId, models: ["opencode/big-pickle"] })];
    const saved = createModelSelection(instanceId, "opencode/kimi-k3", [
      { id: "variant", value: "max" },
      { id: "agent", value: "build" },
    ]);
    const state = deriveEffectiveComposerModelState({
      draft: null,
      providers,
      selectedProvider: driver,
      selectedInstanceId: instanceId,
      threadModelSelection: saved,
      projectModelSelection: null,
      settings: settingsWithProviderInstances(),
    });
    const dispatch = getComposerProviderState({
      provider: driver,
      model: state.selectedModel,
      models: providers[0]!.models,
      modelOptions: state.modelOptions?.[instanceId],
      planModeEnabled: false,
    });

    expect(
      createModelSelection(instanceId, state.selectedModel, dispatch.modelOptionsForDispatch),
    ).toEqual(saved);
  });

  it("keeps a custom-instance draft model while dropping unsupported options", () => {
    const instanceId = ProviderInstanceId.make("claude_openrouter");
    const driver = ProviderDriverKind.make("claudeAgent");
    const providers = [
      provider({ provider: driver, instanceId: "claudeAgent", models: ["claude-opus-5"] }),
      provider({ provider: driver, instanceId, models: ["claude-opus-5"] }),
    ];
    const threadSelection = createModelSelection(instanceId, "claude-opus-5", [
      { id: "effort", value: "high" },
    ]);
    const draftSelection = createModelSelection(instanceId, "openai/gpt-5.5", [
      { id: "effort", value: "max" },
    ]);
    const state = deriveEffectiveComposerModelState({
      draft: {
        activeProvider: instanceId,
        modelSelectionByProvider: { [instanceId]: draftSelection },
      },
      providers,
      selectedProvider: driver,
      selectedInstanceId: instanceId,
      threadModelSelection: threadSelection,
      projectModelSelection: null,
      settings: settingsWithProviderInstances(),
    });
    const dispatch = getComposerProviderState({
      provider: driver,
      model: state.selectedModel,
      models: providers[1]!.models,
      modelOptions: state.modelOptions?.[instanceId],
      planModeEnabled: false,
    });

    expect(
      createModelSelection(instanceId, state.selectedModel, dispatch.modelOptionsForDispatch),
    ).toEqual(draftSelection);
  });

  it("preserves custom provider instances in settings model selection", () => {
    const providers = [
      provider({
        instanceId: "claudeAgent",
        models: ["claude-sonnet-4-6"],
      }),
      provider({
        instanceId: "claude_openrouter",
        models: ["claude-sonnet-4-6"],
      }),
    ];
    const settings: UnifiedSettings = {
      ...settingsWithProviderInstances(),
      textGenerationModelSelection: {
        instanceId: ProviderInstanceId.make("claude_openrouter"),
        model: "openai/gpt-5.5",
      },
    };

    expect(resolveAppModelSelectionState(settings, providers)).toEqual({
      instanceId: ProviderInstanceId.make("claude_openrouter"),
      model: "openai/gpt-5.5",
    });
  });

  it("preserves a persisted choice even when text generation is temporarily unavailable", () => {
    const providers = [
      provider({
        provider: ProviderDriverKind.make("acpRegistry"),
        instanceId: "acp_gemini",
        models: ["default"],
        supportsTextGeneration: false,
      }),
      provider({
        instanceId: "codex",
        models: ["gpt-5.6-luna"],
      }),
    ];
    const settings: UnifiedSettings = {
      ...settingsWithProviderInstances(),
      textGenerationModelSelection: {
        instanceId: ProviderInstanceId.make("acp_gemini"),
        model: "default",
      },
    };

    expect(resolveAppModelSelectionState(settings, providers).instanceId).toBe(
      ProviderInstanceId.make("acp_gemini"),
    );
  });
  it("preserves a saved text generation model absent from the current catalog", () => {
    const codex = provider({ instanceId: "codex", models: ["gpt-6-astra", "gpt-6-luna"] });
    const providers = [
      { ...codex, models: codex.models.map((m, i) => (i === 0 ? { ...m, isDefault: true } : m)) },
    ];
    const settings: UnifiedSettings = {
      ...settingsWithProviderInstances(),
      textGenerationModelSelection: createModelSelection(
        ProviderInstanceId.make("codex"),
        "gpt-5.6-luna",
      ),
    };

    expect(resolveAppModelSelectionState(settings, providers).model).toBe("gpt-5.6-luna");
  });

  it("does not select a provider that cannot generate system text", () => {
    const instanceId = ProviderInstanceId.make("antigravity");
    const unsupported = {
      ...provider({
        provider: ProviderDriverKind.make("antigravity"),
        instanceId,
        models: ["gemini-3.1-pro"],
      }),
      supportsTextGeneration: false,
    };
    const supported = provider({ instanceId: "codex", models: ["gpt-5.6-sol"] });
    const settings = {
      ...settingsWithProviderInstances(),
      textGenerationModelSelection: createModelSelection(instanceId, "gemini-3.1-pro"),
    };

    expect(resolveAppModelSelectionState(settings, [unsupported, supported])).toEqual(
      settings.textGenerationModelSelection,
    );
    expect(resolveAppModelSelectionState(settings, [unsupported])).toEqual(
      settings.textGenerationModelSelection,
    );
  });
});

describe("resolveAppModelSelectionState with the opencode plan agent", () => {
  const instanceId = ProviderInstanceId.make("opencode");
  const model = "opencode/gpt-5.4";
  const opencode: ServerProvider = {
    ...provider({ provider: ProviderDriverKind.make("opencode"), instanceId: "opencode" }),
    models: [
      {
        slug: model,
        name: model,
        isCustom: false,
        capabilities: {
          optionDescriptors: [
            {
              id: "agent",
              label: "Agent",
              type: "select",
              options: [
                { id: "build", label: "Build", isDefault: true },
                { id: "plan", label: "Plan" },
              ],
              currentValue: "build",
            },
          ],
        },
      },
    ],
  };
  const settings: UnifiedSettings = {
    ...DEFAULT_UNIFIED_SETTINGS,
    planModeEnabled: false,
    textGenerationModelSelection: createModelSelection(instanceId, model, [
      { id: "agent", value: "plan" },
    ]),
  };

  it("keeps a stored plan agent this device did not pick", () => {
    expect(resolveAppModelSelectionState(settings, [opencode])).toEqual(
      createModelSelection(instanceId, model, [{ id: "agent", value: "plan" }]),
    );
  });
});

describe("default model settings and new-thread composer parity", () => {
  it.each([
    ["hidden", "claudeAgent", "claude-opus-5", "claude-opus-5", "max"],
    ["visible", "claudeAgent", "claude-opus-5", "claude-opus-5", "max"],
    ["unavailable", "opencode", "openrouter/kimi-k3", "openrouter/kimi-k3", null],
  ] as const)(
    "resolves the %s default and its traits",
    (visibility, kind, model, expectedModel, effort) => {
      const driver = ProviderDriverKind.make(kind);
      const instanceId = ProviderInstanceId.make(`${kind}_work`);
      const snapshot = provider({ provider: driver, instanceId });
      const models: ServerProvider["models"] = ["claude-opus-5-5", "claude-opus-5"].map(
        (slug, index) => ({
          slug,
          name: slug,
          isCustom: false,
          capabilities: {
            optionDescriptors: [
              {
                id: "effort",
                label: "Effort",
                type: "select",
                options: (index === 0 ? ["medium", "high"] : ["high", "max"]).map(
                  (id, optionIndex) => ({ id, label: id, isDefault: optionIndex === 0 }),
                ),
              },
            ],
          },
        }),
      );
      const providers = [{ ...snapshot, models }];
      const stored = createModelSelection(instanceId, model, [{ id: "effort", value: "max" }]);
      const settings: UnifiedSettings = {
        ...settingsWithProviderInstances(),
        providerModelPreferences: {
          [instanceId]: { hiddenModels: visibility === "hidden" ? [model] : [], modelOrder: [] },
        },
      };
      // ChatView builds the local draft with the project default as its thread selection.
      const composer = deriveEffectiveComposerModelState({
        draft: null,
        providers,
        selectedProvider: driver,
        selectedInstanceId: instanceId,
        threadModelSelection: stored,
        projectModelSelection: stored,
        settings,
      });
      const effective = resolveEffectiveDefaultModelSelection(settings, providers, stored);
      const traits = (model: string | null, modelOptions: typeof stored.options) =>
        getComposerProviderState({
          provider: driver,
          model,
          models,
          modelOptions,
          planModeEnabled: settings.planModeEnabled,
        });
      const composerTraits = traits(composer.selectedModel, composer.modelOptions?.[instanceId]);

      expect(composer.selectedModel).toBe(expectedModel);
      expect(traits(effective.model, effective.options)).toEqual(composerTraits);
      expect(effective).toEqual({ ...stored, model: composer.selectedModel });
      expect(composerTraits.promptEffort).toBe(effort);
    },
  );
});

it("merges a native ID with its display override and keeps other instances isolated", () => {
  const id = ProviderInstanceId.make("claude_openrouter");
  const settings: UnifiedSettings = {
    ...settingsWithProviderInstances(),
    providerInstances: {
      [id]: {
        driver: ProviderDriverKind.make("claudeAgent"),
        config: { customModels: [{ slug: "shared/id", name: "Work model" }] },
      },
    },
  };
  const entries = deriveProviderInstanceEntries([
    provider({ instanceId: "claudeAgent", models: ["shared/id"] }),
    provider({ instanceId: id, models: ["shared/id"] }),
  ]);
  const stock = getAllAppModelOptionsForInstance(settings, entries[0]!);
  const custom = getAllAppModelOptionsForInstance(settings, entries[1]!);
  expect(stock.find((model) => model.slug === "shared/id")?.name).toBe("shared/id");
  expect(custom.filter((model) => model.slug === "shared/id")).toMatchObject([
    { name: "Work model" },
  ]);
  const removed: UnifiedSettings = {
    ...settings,
    providerInstances: {
      [id]: { driver: ProviderDriverKind.make("claudeAgent"), config: { customModels: [] } },
    },
  };
  expect(
    getAllAppModelOptionsForInstance(removed, entries[1]!).find(
      (model) => model.slug === "shared/id",
    )?.name,
  ).toBe("shared/id");
});

it("offers only real native and custom models after settings reload", () => {
  const instanceId = ProviderInstanceId.make("claude_openrouter");
  const settings: UnifiedSettings = {
    ...settingsWithProviderInstances(),
    providerInstances: {
      [instanceId]: {
        driver: ProviderDriverKind.make("claudeAgent"),
        config: {
          customModels: Array.from({ length: 48 }, (_, i) => ({
            slug: `custom/${i}`,
            name: `Model ${i}`,
          })),
        },
      },
    },
  };
  const reloaded = JSON.parse(JSON.stringify(settings)) as UnifiedSettings;
  const entry = deriveProviderInstanceEntries([
    provider({ instanceId, models: ["native/model"] }),
  ])[0]!;
  const options = getAllAppModelOptionsForInstance(reloaded, entry);
  expect(options.some((option) => option.slug === "")).toBe(false);
  expect(options.filter((option) => option.isCustom)).toHaveLength(48);
  expect(options.find((option) => option.slug === "custom/47")?.name).toBe("Model 47");
  expect(createModelSelection(instanceId, "").model).toBeNull();
});

it.each([
  "codex",
  "claudeAgent",
  "cursor",
  "opencode",
  "grok",
  "antigravity",
  "pi",
  "muse",
  "acpRegistry",
])("preserves %s choices and parameters through an empty directory", (driverName) => {
  const instanceId = ProviderInstanceId.make(`${driverName}_work`);
  const driver = ProviderDriverKind.make(driverName);
  const providers = [provider({ provider: driver, instanceId, models: [] })];
  const selection = createModelSelection(instanceId, "provider/exact-alias", [
    { id: "effort", value: "custom-effort" },
  ]);
  const settings = settingsWithProviderInstances();
  const entry = deriveProviderInstanceEntries(providers)[0]!;
  expect(
    resolveAppModelSelectionForInstance(instanceId, settings, providers, selection.model),
  ).toBe(selection.model);
  const row = getAllAppModelOptionsForInstance(settings, entry, selection.model).find(
    (option) => option.slug === selection.model,
  );
  expect(row).toMatchObject({ name: "provider/exact-alias" });
  expect(row?.isUnavailable).not.toBe(true);
  const state = deriveEffectiveComposerModelState({
    draft: { activeProvider: instanceId, modelSelectionByProvider: { [instanceId]: selection } },
    providers,
    selectedProvider: driver,
    selectedInstanceId: instanceId,
    threadModelSelection: null,
    projectModelSelection: null,
    settings,
  });
  expect(state.selectedModel).toBe(selection.model);
  const dispatch = getComposerProviderState({
    provider: driver,
    model: state.selectedModel,
    models: [],
    modelOptions: state.modelOptions?.[instanceId],
    planModeEnabled: false,
  });
  expect(dispatch.modelOptionsForDispatch).toEqual(selection.options);
});

it("keeps a hidden explicit choice without putting hidden models back in the menu", () => {
  const providers = [provider({ instanceId: "claudeAgent", models: ["opus", "sonnet"] })];
  const settings: UnifiedSettings = {
    ...settingsWithProviderInstances(),
    providerModelPreferences: {
      [ProviderInstanceId.make("claudeAgent")]: { hiddenModels: ["opus"], modelOrder: [] },
    },
  };
  const entry = deriveProviderInstanceEntries(providers)[0]!;
  expect(getAllAppModelOptionsForInstance(settings, entry, "opus").map((row) => row.slug)).toEqual([
    "sonnet",
  ]);
  expect(resolveAppModelSelectionForInstance(entry.instanceId, settings, providers, "opus")).toBe(
    "opus",
  );
});

it("preserves explicit default semantics through project and draft priority", () => {
  const instanceId = ProviderInstanceId.make("claudeAgent");
  const providers = [provider({ instanceId, models: ["native"] })];
  const driver = ProviderDriverKind.make("claudeAgent");
  const settings = settingsWithProviderInstances();
  const project = createModelSelection(instanceId, null);
  const base = {
    providers,
    selectedProvider: driver,
    selectedInstanceId: instanceId,
    threadModelSelection: null,
    projectModelSelection: project,
    settings,
  };
  expect(deriveEffectiveComposerModelState({ ...base, draft: null }).selectedModel).toBe("");
  const explicit = createModelSelection(instanceId, "user-choice");
  expect(
    deriveEffectiveComposerModelState({
      ...base,
      draft: { activeProvider: instanceId, modelSelectionByProvider: { [instanceId]: explicit } },
    }).selectedModel,
  ).toBe("user-choice");
  expect(
    deriveEffectiveComposerModelState({
      ...base,
      projectModelSelection: explicit,
      draft: { activeProvider: instanceId, modelSelectionByProvider: { [instanceId]: project } },
    }).selectedModel,
  ).toBe("");
});

it("keeps text generation selections while their instance is temporarily unavailable", () => {
  const selection = createModelSelection(ProviderInstanceId.make("custom"), "opaque", [
    { id: "effort", value: "high" },
  ]);
  expect(
    resolveAppModelSelectionState(
      { ...DEFAULT_UNIFIED_SETTINGS, textGenerationModelSelection: selection },
      [],
    ),
  ).toEqual(selection);
});

it("dispatches a new native default as its concrete model and reasoning choice", () => {
  const instanceId = ProviderInstanceId.make("codex_work");
  const snapshot = provider({ instanceId });
  const providers = [
    {
      ...snapshot,
      models: [
        {
          slug: "native/account-model",
          name: "Native account model",
          isCustom: false,
          isDefault: true,
          capabilities: {
            optionDescriptors: [
              {
                id: "reasoningEffort",
                label: "Reasoning",
                type: "select" as const,
                currentValue: "high",
                options: [
                  { id: "medium", label: "Medium", isDefault: true },
                  { id: "high", label: "High" },
                ],
              },
            ],
          },
        },
      ],
    },
  ];
  const state = deriveEffectiveComposerModelState({
    draft: null,
    providers,
    selectedProvider: snapshot.driver,
    selectedInstanceId: instanceId,
    threadModelSelection: { instanceId, model: null },
    projectModelSelection: null,
    settings: settingsWithProviderInstances(),
    isNewThread: true,
  });
  const dispatch = getComposerProviderState({
    provider: snapshot.driver,
    model: state.selectedModel,
    models: providers[0]!.models,
    modelOptions: state.modelOptions?.[instanceId],
    planModeEnabled: true,
  });
  expect(
    createModelSelection(instanceId, state.selectedModel, dispatch.modelOptionsForDispatch),
  ).toEqual({
    instanceId,
    model: "native/account-model",
    options: [{ id: "reasoningEffort", value: "high" }],
  });
  expect(
    getAllAppModelOptionsForInstance(
      settingsWithProviderInstances(),
      deriveProviderInstanceEntries(providers)[0]!,
    ).map((row) => row.slug),
  ).toEqual(["native/account-model"]);
  const hiddenSettings: UnifiedSettings = {
    ...settingsWithProviderInstances(),
    providerModelPreferences: {
      [instanceId]: { hiddenModels: ["native/account-model"], modelOrder: [] },
    },
  };
  const hidden = deriveEffectiveComposerModelState({
    draft: null,
    providers,
    selectedProvider: snapshot.driver,
    selectedInstanceId: instanceId,
    threadModelSelection: { instanceId, model: null },
    projectModelSelection: null,
    settings: hiddenSettings,
    isNewThread: true,
  });
  expect(hidden).toEqual(state);
  expect(
    getAllAppModelOptionsForInstance(
      hiddenSettings,
      deriveProviderInstanceEntries(providers)[0]!,
      hidden.selectedModel,
    ),
  ).toEqual([]);
});

it("keeps old null threads while resolving late new-draft defaults per instance and environment", () => {
  const instanceId = ProviderInstanceId.make("codex_work");
  const snapshot = provider({ instanceId });
  const settings = settingsWithProviderInstances();
  const makeProviders = (slug: string) => [
    {
      ...snapshot,
      models: [
        {
          slug,
          name: slug,
          isCustom: false,
          isDefault: true,
          capabilities: null,
        },
      ],
    },
  ];
  const input = {
    draft: null,
    providers: makeProviders("environment-a/model"),
    selectedProvider: snapshot.driver,
    selectedInstanceId: instanceId,
    threadModelSelection: { instanceId, model: null },
    projectModelSelection: null,
    settings,
  };
  expect(deriveEffectiveComposerModelState(input).selectedModel).toBe("");
  expect(deriveEffectiveComposerModelState({ ...input, isNewThread: true }).selectedModel).toBe(
    "environment-a/model",
  );
  expect(
    deriveEffectiveComposerModelState({ ...input, providers: [], isNewThread: true }).selectedModel,
  ).toBe("");
  expect(
    deriveEffectiveComposerModelState({
      ...input,
      providers: makeProviders("environment-b/model"),
      isNewThread: true,
    }).selectedModel,
  ).toBe("environment-b/model");
  const manual = {
    instanceId,
    model: "my/choice",
    options: [{ id: "reasoningEffort", value: "low" }],
  };
  const draft = { activeProvider: instanceId, modelSelectionByProvider: { [instanceId]: manual } };
  expect(
    deriveEffectiveComposerModelState({
      ...input,
      draft,
      providers: makeProviders("late/default"),
      isNewThread: true,
    }),
  ).toEqual({
    selectedModel: "my/choice",
    modelOptions: { [instanceId]: manual.options },
  });
  const other = ProviderInstanceId.make("codex_other");
  expect(
    deriveEffectiveComposerModelState({
      ...input,
      draft,
      selectedInstanceId: other,
      providers: [{ ...makeProviders("other/default")[0]!, instanceId: other }],
      isNewThread: true,
    }).selectedModel,
  ).toBe("other/default");
});
