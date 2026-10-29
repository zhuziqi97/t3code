import { useTranslate } from "../../i18n";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useState } from "react";
import { ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import { Tabs } from "@base-ui/react/tabs";
import { DialogPanel, DialogFooter } from "../ui/dialog";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "../ui/select";
import { Link } from "@tanstack/react-router";
import { ConveneModulePicker } from "./ConveneModulePicker";
import { useConveneProjectConfiguration } from "./useConveneProjectConfiguration";

type ProjectProps = { environmentId: EnvironmentId; projectId: ProjectId };
type ProjectState = ReturnType<typeof useConveneProjectConfiguration>;

export function ConveneProjectPanel(props: ProjectProps) {
  const state = useConveneProjectConfiguration(props.environmentId, props.projectId);
  return <ProjectConfigurationContent {...props} state={state} />;
}

export function ConveneProjectSetup({
  onDone,
  onLater,
  ...props
}: ProjectProps & {
  onDone: () => void;
  onLater: () => void;
}) {
  const t = useTranslate();
  const state = useConveneProjectConfiguration(props.environmentId, props.projectId);
  const complete = async () => {
    if (!state.dirty || (await state.save())) onDone();
  };
  return (
    <>
      <DialogPanel>
        <ProjectConfigurationContent {...props} state={state} setup onOpenConnection={onDone} />
      </DialogPanel>
      <DialogFooter>
        <Button variant="ghost" disabled={state.busy} onClick={onLater}>
          {t("convene.dialog.defer")}
        </Button>
        <Button
          disabled={state.busy || (state.dirty && !state.canWrite)}
          onClick={() => void complete()}
        >
          {state.busy
            ? t("convene.project.updating")
            : state.dirty
              ? t("convene.dialog.saveDone")
              : t("convene.dialog.done")}
        </Button>
      </DialogFooter>
    </>
  );
}

function ProjectConfigurationContent({
  environmentId,
  projectId,
  state,
  setup = false,
  onOpenConnection,
}: ProjectProps & {
  state: ProjectState;
  setup?: boolean;
  onOpenConnection?: () => void;
}) {
  const t = useTranslate();
  const { configuration, draft } = state;
  const needsInitialConnection = state.needsConnection && configuration === null;
  const [picker, setPicker] = useState<"scope" | "bind" | null>(null);
  const [selectedNames, setSelectedNames] = useState<Record<string, string>>({});
  const scopeNames = {
    ...selectedNames,
    ...Object.fromEntries(
      (configuration?.mcp_scope_details ?? []).map((item) => [
        item.module_id,
        `${item.project_name} / ${item.module_name}`,
      ]),
    ),
  };
  const bindings = configuration?.bindings.filter((binding) => binding.status !== "REVOKED") ?? [];
  const tools = [
    ["forge_enabled", t("convene.capability.repository")],
    ["code_graph_enabled", t("convene.capability.graph")],
    ["issue_enabled", t("convene.capability.issues")],
  ] as const;
  const enabledTools = tools
    .filter(([name]) => draft?.capabilities[name])
    .map(([, label]) => label);
  return (
    <div className="space-y-3">
      {state.error && !needsInitialConnection && (
        <Alert variant="error">
          <AlertDescription>
            <p>{t(state.lastOperation ? "convene.error.save" : "convene.error.load")}</p>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs">
                {t("convene.project.errorDetails")}
              </summary>
              <p className="mt-1 break-words text-xs">{state.error}</p>
            </details>
          </AlertDescription>
        </Alert>
      )}
      <div className="flex items-center justify-between gap-3">
        {configuration ? (
          <p className="min-w-0 truncate text-sm font-medium">
            {configuration.project.display_name}
          </p>
        ) : needsInitialConnection ? (
          <p className="text-sm text-muted-foreground">{t("convene.project.optional")}</p>
        ) : !state.error ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("convene.project.waiting")}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("convene.project.refresh")}
          title={t("convene.project.refresh")}
          disabled={state.busy}
          onClick={() => void state.refresh()}
        >
          <RefreshCwIcon className={state.busy ? "size-4 animate-spin" : "size-4"} />
        </Button>
      </div>
      {configuration && (!state.online || !state.fresh) && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("convene.project.cached")}
        </p>
      )}
      {state.needsConnection && (
        <Button
          variant="outline"
          render={<Link to="/settings/convene" search={{ machine: environmentId }} />}
          onClick={onOpenConnection}
        >
          {t("convene.project.openConnectionSettings")}
        </Button>
      )}
      {configuration && draft && (
        <>
          {!state.permitted && (
            <p className="text-sm text-muted-foreground">{t("convene.project.noPermission")}</p>
          )}
          <Tabs.Root defaultValue="bindings" className="space-y-3">
            <Tabs.List
              className="relative isolate flex w-fit gap-0.5 rounded-lg bg-input/40 p-0.5"
              aria-label={t("convene.dialog.title")}
            >
              <Tabs.Tab
                value="bindings"
                render={(props, state) => (
                  <Button {...props} variant={state.active ? "ghost" : "ghost-muted"} size="sm" />
                )}
                className="relative z-10"
              >
                {t("convene.project.webTitle")}
              </Tabs.Tab>
              <Tabs.Tab
                value="mcp"
                render={(props, state) => (
                  <Button {...props} variant={state.active ? "ghost" : "ghost-muted"} size="sm" />
                )}
                className="relative z-10"
              >
                {t("convene.project.localTitle")}
              </Tabs.Tab>
              <Tabs.Indicator className="pointer-events-none absolute top-0 left-0 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) translate-y-(--active-tab-top) rounded-md bg-background shadow-xs/10 transition-[translate,width] duration-150 ease-out motion-reduce:transition-none dark:bg-input/72" />
            </Tabs.List>
            <Tabs.Panel
              value="mcp"
              className="space-y-3 transition-opacity duration-150 ease-out data-starting-style:opacity-0 data-ending-style:hidden motion-reduce:transition-none"
            >
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span className="text-sm font-medium">{t("convene.project.mcpEnable")}</span>
                <Switch
                  checked={draft.enabled}
                  disabled={state.busy || !state.permitted}
                  onCheckedChange={(enabled) => {
                    state.edit({ ...draft, enabled });
                  }}
                />
              </label>
              <div className="space-y-3 border-t pt-3">
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t("convene.project.accessModules")}</p>
                  <Button
                    variant="outline"
                    disabled={!state.canWrite}
                    onClick={() => setPicker("scope")}
                  >
                    {draft.scope.length > 0
                      ? t("convene.project.editScope", { count: draft.scope.length })
                      : t("convene.project.chooseModules")}
                  </Button>
                  <div className="max-h-32 space-y-1 overflow-y-auto">
                    {draft.scope.map((entry) =>
                      scopeNames[entry.module_id] ? (
                        <p key={entry.module_id} className="text-xs text-muted-foreground">
                          {scopeNames[entry.module_id]} ·{" "}
                          {t(
                            entry.permission === "WRITE"
                              ? "convene.permission.write"
                              : "convene.permission.read",
                          )}
                        </p>
                      ) : null,
                    )}
                  </div>
                </div>
                <details className="group/tools">
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
                    <ChevronRightIcon className="size-4 transition-transform group-open/tools:rotate-90" />
                    <span>{t("convene.project.moreTools")}</span>
                    {enabledTools.length > 0 && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {enabledTools.join("、")}
                      </span>
                    )}
                  </summary>
                  <div className="space-y-3 pt-3">
                    {tools.map(([name, label]) => (
                      <div key={name} className="flex items-center justify-between gap-3">
                        <span className="text-sm">{label}</span>
                        <Switch
                          aria-label={label}
                          checked={draft.capabilities[name]}
                          disabled={state.busy || !state.permitted}
                          onCheckedChange={(enabled) =>
                            state.edit({
                              ...draft,
                              capabilities: { ...draft.capabilities, [name]: enabled },
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                </details>
              </div>
              {!setup && state.dirty && (
                <div className="flex items-center gap-2 border-t pt-3">
                  <Button disabled={!state.canWrite} onClick={() => void state.save()}>
                    {t("convene.project.save")}
                  </Button>
                  <Button variant="ghost" disabled={state.busy} onClick={state.discard}>
                    {t("convene.project.discard")}
                  </Button>
                </div>
              )}
            </Tabs.Panel>
            <Tabs.Panel
              value="bindings"
              className="space-y-3 transition-opacity duration-150 ease-out data-starting-style:opacity-0 data-ending-style:hidden motion-reduce:transition-none"
            >
              <div className="space-y-3">
                <Button
                  variant="outline"
                  disabled={!state.canWrite}
                  onClick={() => setPicker("bind")}
                >
                  {t("convene.project.associate")}
                </Button>
                {bindings.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("convene.project.noAssociations")}
                  </p>
                )}
                {bindings.map((binding) => {
                  const detail = configuration.binding_module_details.find(
                    (item) => item.module_id === binding.module_id,
                  );
                  const target = configuration.targets.find(
                    (item) => item.target_id === binding.target_id,
                  );
                  return (
                    <div key={binding.binding_id} className="space-y-2 rounded-lg border p-3">
                      <p className="text-sm font-medium">
                        {detail
                          ? `${detail.project_name} / ${detail.module_name}`
                          : binding.module_id}{" "}
                        ·{" "}
                        {binding.status === "ACTIVE"
                          ? t("convene.project.active")
                          : t("convene.project.inactive")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("convene.project.executionFolder")}
                      </p>
                      <Select
                        value={binding.target_id ?? "none"}
                        items={[
                          { value: "none", label: t("convene.project.chooseTarget") },
                          ...configuration.targets.map((item) => ({
                            value: item.target_id,
                            label: `${item.native_workspace_key === "root" ? t("convene.project.rootFolder") : item.workspace_display_name}${item.branch ? ` · ${item.branch}` : ""}${item.availability !== "AVAILABLE" ? t("convene.project.unavailableSuffix") : ""}`,
                          })),
                        ]}
                        disabled={!state.canWrite || binding.status === "ACTIVE"}
                        onValueChange={(value) => {
                          if (value)
                            void state.run({
                              operation: "select-target",
                              projectId,
                              binding_id: binding.binding_id,
                              target_id: value === "none" ? null : value,
                            });
                        }}
                      >
                        <SelectTrigger
                          aria-label={t("convene.project.targetFor", {
                            module: detail?.module_name ?? binding.module_id,
                          })}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectPopup>
                          <SelectItem value="none">{t("convene.project.chooseTarget")}</SelectItem>
                          {configuration.targets.map((item) => (
                            <SelectItem
                              key={item.target_id}
                              value={item.target_id}
                              disabled={item.availability !== "AVAILABLE"}
                            >
                              {item.native_workspace_key === "root"
                                ? t("convene.project.rootFolder")
                                : item.workspace_display_name}
                              {item.branch ? ` · ${item.branch}` : ""}
                              {item.availability !== "AVAILABLE"
                                ? t("convene.project.unavailableSuffix")
                                : ""}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                      {target?.path && (
                        <p className="break-all text-xs text-muted-foreground">{target.path}</p>
                      )}
                      {target?.availability === "UNAVAILABLE" && (
                        <p role="status" className="text-sm text-muted-foreground">
                          {t("convene.project.workspaceUnavailable")}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {binding.status === "ACTIVE" ? (
                          <Button
                            variant="outline"
                            disabled={!state.canWrite}
                            onClick={() =>
                              void state.run({
                                operation: "deactivate",
                                projectId,
                                binding_id: binding.binding_id,
                              })
                            }
                          >
                            {t("convene.project.deactivate")}
                          </Button>
                        ) : (
                          <Button
                            disabled={
                              !state.canWrite || !target || target.availability !== "AVAILABLE"
                            }
                            onClick={() => {
                              if (target)
                                void state.run({
                                  operation: "activate",
                                  projectId,
                                  binding_id: binding.binding_id,
                                  target_id: target.target_id,
                                });
                            }}
                          >
                            {t("convene.project.activate")}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          disabled={!state.canWrite}
                          onClick={() =>
                            void state.run({
                              operation: "unbind",
                              projectId,
                              binding_id: binding.binding_id,
                            })
                          }
                        >
                          {t("convene.project.unbind")}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Tabs.Panel>
          </Tabs.Root>
        </>
      )}
      {state.lastOperation && state.error && (
        <Button
          variant="outline"
          disabled={!state.canWrite}
          onClick={() => {
            if (state.lastOperation?.operation === "save") void state.save();
            else if (state.lastOperation) void state.run(state.lastOperation);
          }}
        >
          {t("convene.project.retry")}
        </Button>
      )}
      {picker && draft && (
        <ConveneModulePicker
          environmentId={environmentId}
          initialScope={picker === "scope" ? draft.scope : []}
          initialNames={scopeNames}
          {...(picker === "scope"
            ? {
                onScope: (scope, names) => {
                  setSelectedNames(names);
                  state.edit({ ...draft, scope });
                },
              }
            : {
                boundModuleIds: bindings.map((binding) => binding.module_id),
                onModule: (moduleId) =>
                  void state.run({ operation: "bind", projectId, module_id: moduleId }),
              })}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
