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
  const state = useConveneProjectConfiguration(environmentId, projectId);
  const { configuration, draft } = state;
  const [picker, setPicker] = useState<"scope" | "bind" | null>(null);
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Your local project is already available. Convene configuration is optional and can be
        changed later from Project settings.
      </p>
      {state.error && (
        <Alert variant="error">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={state.busy} onClick={() => void state.refresh()}>
          {state.busy ? "Updating…" : "Refresh configuration and workspaces"}
        </Button>
        <span role="status" className="text-xs text-muted-foreground">
          {state.online && state.fresh
            ? "Current platform configuration"
            : configuration
              ? "Cached configuration · writes unavailable"
              : "Waiting for a connected client project"}
        </span>
      </div>
      {!configuration || !state.online ? (
        <ConveneConnectionPanel environmentId={environmentId} />
      ) : null}
      {configuration && draft && (
        <>
          {!state.permitted && (
            <p className="text-sm text-muted-foreground">
              This connection cannot change project configuration.
            </p>
          )}
          <section className="space-y-3" aria-labelledby="convene-associations-title">
            <h3 id="convene-associations-title" className="text-sm font-medium">
              Execution associations
            </h3>
            <p className="text-sm text-muted-foreground">
              Associate several Convene modules with this project. Each module has one active
              execution location across all clients. Activating here moves that module to this
              location.
            </p>
            <Button variant="outline" disabled={!state.canWrite} onClick={() => setPicker("bind")}>
              Associate module
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
                      · {binding.status === "ACTIVE" ? "Active here" : "Associated, inactive"}
                    </p>
                    <Select
                      value={binding.target_id ?? "none"}
                      items={[
                        { value: "none", label: "Choose an execution location" },
                        ...configuration.targets.map((item) => ({
                          value: item.target_id,
                          label: `${item.workspace_display_name}${item.branch ? ` · ${item.branch}` : ""}${item.availability !== "AVAILABLE" ? " · Unavailable" : ""}`,
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
                        aria-label={`Execution location for ${detail?.module_name ?? binding.module_id}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup>
                        <SelectItem value="none">Choose an execution location</SelectItem>
                        {configuration.targets.map((item) => (
                          <SelectItem
                            key={item.target_id}
                            value={item.target_id}
                            disabled={item.availability !== "AVAILABLE"}
                          >
                            {item.workspace_display_name}
                            {item.branch ? ` · ${item.branch}` : ""}
                            {item.availability !== "AVAILABLE" ? " · Unavailable" : ""}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                    {target?.path && (
                      <p className="break-all text-xs text-muted-foreground">{target.path}</p>
                    )}
                    {target?.availability === "UNAVAILABLE" && (
                      <p role="status" className="text-sm text-muted-foreground">
                        This workspace was removed or cannot be accessed. Its existing sessions
                        retain their original identity. Select another location for new work.
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
                          Deactivate
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
                          Activate here
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
                        Remove association
                      </Button>
                    </div>
                  </div>
                );
              })}
            {configuration.bindings.every((binding) => binding.status === "REVOKED") && (
              <p className="text-sm text-muted-foreground">
                No execution associations. Local development and independently configured MCP remain
                available.
              </p>
            )}
          </section>
          <section className="space-y-3" aria-labelledby="convene-mcp-title">
            <h3 id="convene-mcp-title" className="text-sm font-medium">
              Project MCP
            </h3>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">Enable Convene MCP for this project</span>
              <Switch
                aria-label="Enable Convene MCP"
                checked={draft.enabled}
                disabled={state.busy || !state.permitted}
                onCheckedChange={(enabled) => state.edit({ ...draft, enabled })}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              MCP access can include modules from different platform projects, independently of
              execution associations. The platform enforces saved permissions for MCP requests.
              Configuration changes do not restart an active provider process.
            </p>
            <Button variant="outline" disabled={!state.canWrite} onClick={() => setPicker("scope")}>
              Edit MCP module access ({draft.scope.length})
            </Button>
            <div className="space-y-1">
              {draft.scope.map((entry) => {
                const detail = configuration.mcp_scope_details.find(
                  (item) => item.module_id === entry.module_id,
                );
                return (
                  <p key={entry.module_id} className="text-xs text-muted-foreground">
                    {detail ? `${detail.project_name} / ${detail.module_name}` : entry.module_id} ·{" "}
                    {entry.permission === "WRITE" ? "Read and write" : "Read"}
                  </p>
                );
              })}
            </div>
            {(
              [
                ["forge_enabled", "Repository tools"],
                ["code_graph_enabled", "Code graph"],
                ["issue_enabled", "Issue tools"],
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
                Save MCP configuration
              </Button>
              <Button variant="ghost" disabled={state.busy || !state.dirty} onClick={state.discard}>
                Discard MCP draft
              </Button>
              <span role="status" className="text-xs text-muted-foreground">
                {state.dirty ? "Unsaved draft retained on this device" : "No unsaved changes"}
              </span>
            </div>
          </section>
          <p className="text-xs text-muted-foreground">
            Convene execution supports native Codex and Claude providers. Other providers remain
            available in T3 Code without a Convene execution support claim.
          </p>
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
          Retry failed operation
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
