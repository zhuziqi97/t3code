import { useTranslate } from "../../i18n";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useState } from "react";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "../ui/select";
import { ConveneConnectionPanel } from "./ConveneConnectionPanel";
import { ConveneModulePicker } from "./ConveneModulePicker";
import { useConveneProjectConfiguration } from "./useConveneProjectConfiguration";

export function ConveneProjectPanel({
  environmentId,
  projectId,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
}) {
  const t = useTranslate();
  const state = useConveneProjectConfiguration(environmentId, projectId);
  const { configuration, draft } = state;
  const [picker, setPicker] = useState<"scope" | "bind" | null>(null);
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t("convene.project.optional")}</p>
      {state.error && (
        <Alert variant="error">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={state.busy} onClick={() => void state.refresh()}>
          {state.busy ? t("convene.project.updating") : t("convene.project.refresh")}
        </Button>
        <span role="status" className="text-xs text-muted-foreground">
          {state.online && state.fresh
            ? t("convene.project.current")
            : configuration
              ? t("convene.project.cached")
              : t("convene.project.waiting")}
        </span>
      </div>
      {!configuration || !state.online ? (
        <ConveneConnectionPanel environmentId={environmentId} />
      ) : null}
      {configuration && draft && (
        <>
          {!state.permitted && (
            <p className="text-sm text-muted-foreground">{t("convene.project.noPermission")}</p>
          )}
          <section className="space-y-3" aria-labelledby="convene-associations-title">
            <h3 id="convene-associations-title" className="text-sm font-medium">
              {t("convene.project.associations")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("convene.project.associationsDescription")}
            </p>
            <Button variant="outline" disabled={!state.canWrite} onClick={() => setPicker("bind")}>
              {t("convene.project.associate")}
            </Button>
            {configuration.bindings
              .filter((binding) => binding.status !== "REVOKED")
              .map((binding) => {
                const detail = configuration.binding_module_details.find(
                  (item) => item.module_id === binding.module_id,
                );
                const target = configuration.targets.find(
                  (item) => item.target_id === binding.target_id,
                );
                return (
                  <div key={binding.binding_id} className="space-y-2">
                    <p className="text-sm font-medium">
                      {detail
                        ? `${detail.project_name} / ${detail.module_name}`
                        : binding.module_id}{" "}
                      ·{" "}
                      {binding.status === "ACTIVE"
                        ? t("convene.project.active")
                        : t("convene.project.inactive")}
                    </p>
                    <Select
                      value={binding.target_id ?? "none"}
                      items={[
                        { value: "none", label: t("convene.project.chooseTarget") },
                        ...configuration.targets.map((item) => ({
                          value: item.target_id,
                          label: `${item.workspace_display_name}${item.branch ? ` · ${item.branch}` : ""}${item.availability !== "AVAILABLE" ? t("convene.project.unavailableSuffix") : ""}`,
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
                            {item.workspace_display_name}
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
            {configuration.bindings.every((binding) => binding.status === "REVOKED") && (
              <p className="text-sm text-muted-foreground">{t("convene.project.noAssociations")}</p>
            )}
          </section>
          <section className="space-y-3" aria-labelledby="convene-mcp-title">
            <h3 id="convene-mcp-title" className="text-sm font-medium">
              {t("convene.project.mcp")}
            </h3>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">{t("convene.project.mcpEnableDescription")}</span>
              <Switch
                aria-label={t("convene.project.mcpEnable")}
                checked={draft.enabled}
                disabled={state.busy || !state.permitted}
                onCheckedChange={(enabled) => state.edit({ ...draft, enabled })}
              />
            </div>
            <p className="text-sm text-muted-foreground">{t("convene.project.mcpDescription")}</p>
            <Button variant="outline" disabled={!state.canWrite} onClick={() => setPicker("scope")}>
              {t("convene.project.editScope", { count: draft.scope.length })}
            </Button>
            <div className="space-y-1">
              {draft.scope.map((entry) => {
                const detail = configuration.mcp_scope_details.find(
                  (item) => item.module_id === entry.module_id,
                );
                return (
                  <p key={entry.module_id} className="text-xs text-muted-foreground">
                    {detail ? `${detail.project_name} / ${detail.module_name}` : entry.module_id} ·{" "}
                    {entry.permission === "WRITE"
                      ? t("convene.permission.write")
                      : t("convene.permission.read")}
                  </p>
                );
              })}
            </div>
            {(
              [
                ["forge_enabled", t("convene.capability.repository")],
                ["code_graph_enabled", t("convene.capability.graph")],
                ["issue_enabled", t("convene.capability.issues")],
              ] as const
            ).map(([name, label]) => (
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
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={!state.canWrite || !state.dirty} onClick={() => void state.save()}>
                {t("convene.project.save")}
              </Button>
              <Button variant="ghost" disabled={state.busy || !state.dirty} onClick={state.discard}>
                {t("convene.project.discard")}
              </Button>
              <span role="status" className="text-xs text-muted-foreground">
                {state.dirty ? t("convene.project.dirty") : t("convene.project.saved")}
              </span>
            </div>
          </section>
          <p className="text-xs text-muted-foreground">{t("convene.project.providers")}</p>
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
          {...(picker === "scope"
            ? { onScope: (scope) => state.edit({ ...draft, scope }) }
            : {
                onModule: (moduleId) =>
                  void state.run({ operation: "bind", projectId, module_id: moduleId }),
              })}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
