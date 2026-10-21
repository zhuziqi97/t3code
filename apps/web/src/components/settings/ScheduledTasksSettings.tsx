import { i18n, useTranslate } from "~/i18n";
import { useAtomValue } from "@effect/atom-react";
import { connectionStatusTitle } from "@t3tools/client-runtime/connection";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import {
  Clock3Icon,
  CopyIcon,
  InboxIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type {
  EnvironmentId,
  ModelSelection,
  OrchestrationV2ThreadLaunchWorkspaceStrategy,
  ProjectId,
  ScheduledTask,
  ScheduledTaskId,
  ScheduledTaskSchedule,
  ScheduledTaskUpsertInput,
  ScheduledTaskWebhookDeliverySummary,
  ThreadId,
} from "@t3tools/contracts";
import {
  DEFAULT_WEBHOOK_PROMPT,
  emptyWebhookFilterDraft,
  parseWebhookFilterDrafts,
  removeWebhookFilterDraft,
  WEBHOOK_FILTER_OPS,
  type WebhookFilterDraft,
} from "@t3tools/client-runtime/scheduled-task-webhook";
import {
  MAX_WEBHOOK_DELIVERY_AGE_MINUTES,
  MAX_WEBHOOK_FILTERS,
  MIN_SCHEDULED_TASK_INTERVAL_MS,
  ProviderInstanceId,
  resolveEnvironmentMachineKind,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { formatRelativeTime } from "../../timestampFormat";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { usePrimaryCloudLinkState } from "../../cloud/primaryCloudLinkState";
import { requestConfirmDialog } from "../../confirmDialog";
import { webhookAddress } from "@t3tools/client-runtime/webhook-address";
import { Link } from "@tanstack/react-router";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useNowMinute } from "../../hooks/useNowMinute";
import {
  useEnvironment,
  useEnvironmentHttpBaseUrl,
  type EnvironmentPresentation,
} from "../../state/environments";
import { useProjects } from "../../state/entities";
import { environmentAtomList, environmentIdsKey } from "../../state/environmentAtomList";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "../../state/query";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { WorktreeBaseBranchPicker } from "../WorktreeBaseBranchPicker";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { ConnectionStatusDot, connectionPhaseDotClassName } from "../ConnectionStatusDot";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { readEnvironmentScope } from "~/state/session";
import { useSettingsScope } from "./SettingsScopeContext";
import { EnvironmentRow, environmentTransportLabel } from "./EnvironmentRow";
import { SettingsGroup } from "./SettingsGroup";
import { settingsScopeEnvironmentLabel, settingsScopeEnvironmentLabels } from "./settingsScopeAxis";
import {
  WEBHOOK_SIGNATURE_DEFAULTS,
  webhookDraftErrors,
  webhookDeliveryLabel,
  matchesScheduledTaskScope,
  scheduleFromDraft,
  scheduledTaskDefaultModel,
  taskToDraft,
  type DraftState,
  type ScheduleMode,
  type WorkspaceMode,
} from "./scheduledTasksSettings.logic";
import { Label } from "../ui/label";
import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator } from "../ui/menu";
import { ToggleGroup, Toggle } from "../ui/toggle-group";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "../ui/empty";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
} from "./settingsLayout";

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const WEEKDAY_LABELS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const WORKSPACE_MODE_LABELS: Record<WorkspaceMode, string> = {
  worktree: "scheduled.createANewWorktree",
  root: "scheduled.useTheProjectCheckout",
  existing_worktree: "scheduled.useASpecificCheckout",
};

const EMPTY_DRAFT: DraftState = {
  editingId: null,
  title: "",
  prompt: "",
  enabled: true,
  scheduleMode: "fixed",
  intervalMinutes: "15",
  timeOfDay: "09:00",
  weekdays: new Set([1, 2, 3, 4, 5]),
  projectId: "",
  threadId: "",
  workspaceMode: "worktree",
  baseRef: "main",
  startFromOrigin: true,
  existingWorktreePath: "",
  modelKey: "",
  runtimeMode: "full-access",
  interactionMode: "default",
  baseModelSelection: null,
  signatureEnabled: false,
  ...WEBHOOK_SIGNATURE_DEFAULTS,
  signatureSecret: "",
  maxDeliveryAgeMinutes: "",
  replayKey: "",
  coalesceKey: "",
  coalesceWindowSeconds: "",
  filters: [],
  savedFilters: [],
};

function WebhookFiltersField({
  filters,
  onChange,
}: {
  filters: ReadonlyArray<WebhookFilterDraft>;
  onChange: (filters: ReadonlyArray<WebhookFilterDraft>) => void;
}) {
  const t = useTranslate();
  const update = (index: number, patch: Partial<WebhookFilterDraft>) =>
    onChange(filters.map((filter, at) => (at === index ? { ...filter, ...patch } : filter)));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <Label>{t("pullRequest.list.filters")}</Label>
          <p className="text-sm text-muted-foreground">
            {t("scheduled.runOnlyWhenEveryFilterMatchesOtherRequests")}
          </p>
        </div>
        <Button
          className="shrink-0"
          variant="outline"
          size="sm"
          disabled={filters.length >= MAX_WEBHOOK_FILTERS}
          onClick={() => onChange([...filters, emptyWebhookFilterDraft()])}
        >
          <PlusIcon />
          {t("scheduled.addFilter")}
        </Button>
      </div>
      {filters.map((filter, index) => (
        // Always stacked: the dialog stays narrow on wide windows, so a single line
        // would cut off typical paths and values. The grid wrappers size each control
        // without restyling it; a grid item stretches to its minmax(0, 1fr) track.
        <div key={filter.id} className="space-y-2 pt-1">
          <div className="flex items-center gap-2">
            <div className="grid min-w-0 flex-1 grid-cols-1">
              <Input
                aria-label={t("scheduled.filterPath", { number: index + 1 })}
                placeholder="body.action"
                value={filter.path}
                onChange={(event) => update(index, { path: event.target.value })}
              />
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("scheduled.removeFilter", { number: index + 1 })}
              onClick={() => onChange(removeWebhookFilterDraft(filters, filter.id))}
            >
              <Trash2Icon />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={filter.op}
              onValueChange={(op) => {
                const known = WEBHOOK_FILTER_OPS.find((option) => option.op === op);
                if (known) update(index, { op: known.op });
              }}
            >
              <div className="grid w-44 shrink-0 grid-cols-1">
                <SelectTrigger
                  size="sm"
                  aria-label={t("scheduled.filterTest", { number: index + 1 })}
                >
                  <SelectValue>
                    {t(`scheduled.filter.${filter.op}`, {
                      defaultValue: WEBHOOK_FILTER_OPS.find((option) => option.op === filter.op)
                        ?.label,
                    })}
                  </SelectValue>
                </SelectTrigger>
              </div>
              <SelectPopup>
                {WEBHOOK_FILTER_OPS.map((option) => (
                  <SelectItem key={option.op} value={option.op}>
                    {t(`scheduled.filter.${option.op}`, { defaultValue: option.label })}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            {filter.op === "exists" ? null : (
              <div className="grid min-w-0 flex-1 grid-cols-1">
                <Input
                  aria-label={t("scheduled.filterValue", { number: index + 1 })}
                  placeholder={filter.op === "in" ? "opened, reopened" : "opened"}
                  value={filter.value}
                  onChange={(event) => update(index, { value: event.target.value })}
                />
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-baseline justify-between" htmlFor={htmlFor}>
        <span>{label}</span>
        {hint ? (
          <span className="font-normal text-2xs text-muted-foreground/80">{hint}</span>
        ) : null}
      </Label>
      {children}
    </div>
  );
}

function splitModelKey(value: string): ModelSelection | null {
  const index = value.indexOf(":");
  if (index <= 0) return null;
  return {
    instanceId: ProviderInstanceId.make(value.slice(0, index)),
    model: value.slice(index + 1) || null,
  };
}

export function scheduleLabel(schedule: ScheduledTaskSchedule, t = i18n.t): string {
  if (schedule.type === "webhook") return t("scheduled.onWebhook");
  if (schedule.type === "interval") {
    const minutes = schedule.everyMs / 60_000;
    return Number.isInteger(minutes)
      ? t("scheduled.everyMinutes", { count: minutes })
      : t("scheduled.everySeconds", { count: Math.round(schedule.everyMs / 1000) });
  }
  const weekdays = schedule.weekdays ?? [];
  const days =
    weekdays.length === 0
      ? t("scheduled.daily")
      : weekdays.length === 5 && weekdays.every((day) => day >= 1 && day <= 5)
        ? t("scheduled.weekdays")
        : weekdays.map((day) => t(`scheduled.weekday.${WEEKDAY_LABELS[day]}`)).join(", ");
  return t("scheduled.atTime", { days, time: schedule.timeOfDay });
}

/**
 * `formatRelativeTime` only handles the past, and `nextRunAt` is a future
 * instant — render "in 5m" style labels for upcoming runs instead of a
 * misleading "just now".
 */
function relativeLabel(value: string | null, nowMs: number, t: typeof i18n.t): string {
  if (!value) return t("scheduled.notScheduled");
  const diffMs = new Date(value).getTime() - nowMs;
  if (diffMs <= 0) {
    const relative = formatRelativeTime(value, undefined, nowMs);
    if (!relative) return t("scheduled.notScheduled");
    return relative.suffix ? `${relative.value} ${relative.suffix}` : relative.value;
  }
  const minutes = Math.ceil(diffMs / 60_000);
  if (minutes < 2) return t("scheduled.inUnderAMinute");
  if (minutes < 60) return t("scheduled.inMinutes", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("scheduled.inHours", { count: hours });
  return t("scheduled.inDays", { count: Math.round(hours / 24) });
}

// The clock is the label's own minute tick: the React Compiler caches a
// `Date.now()` read in render on the timestamp alone.
export function ScheduledRelativeLabel(props: { value: string | null }) {
  const t = useTranslate();
  const nowMinute = useNowMinute();
  return relativeLabel(props.value, Date.parse(`${nowMinute}:00.000Z`), t);
}

function deliveryOutcomeVariant(outcome: string) {
  if (outcome === "accepted") return "success";
  if (
    outcome === "duplicate" ||
    outcome === "coalesced" ||
    outcome === "disabled" ||
    outcome === "rate_limited" ||
    outcome === "expired"
  ) {
    return "warning";
  }
  if (outcome === "dispatch_failed" || outcome === "rejected_signature") return "error";
  return "outline";
}

function statusVariant(status: ScheduledTask["lastRunStatus"]) {
  if (status === "failed") return "error";
  if (status === "succeeded") return "success";
  if (status === "running") return "info";
  return "outline";
}

export function ScheduledTasksSettings(target: {
  readonly environmentId?: EnvironmentId;
  readonly taskId?: ScheduledTaskId | undefined;
}) {
  const t = useTranslate();
  const { scope, environments, connectedEnvironments, environment } = useSettingsScope();
  const [editor, setEditor] = useState<{
    environmentId: EnvironmentId;
    task: ScheduledTask | null;
  } | null>(null);
  const openForEdit = (environmentId: EnvironmentId, task: ScheduledTask) => {
    setEditor({ environmentId, task });
  };
  const defaultEnvironment = environment ?? connectedEnvironments[0];
  const canCreate = useAtomValue(
    serverEnvironment.upsertScheduledTask.permissionAtom(defaultEnvironment?.environmentId ?? null),
  );
  return (
    <SettingsPageContainer>
      <SettingsSection
        title={t("scheduled.scheduledTasks")}
        variant="plain"
        headerAction={
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={!defaultEnvironment || !canCreate}
            onClick={() =>
              defaultEnvironment &&
              setEditor({ environmentId: defaultEnvironment.environmentId, task: null })
            }
          >
            <PlusIcon className="size-3" />
            {t("scheduled.newTask")}
          </Button>
        }
      >
        {scope.kind === "unavailable" ? (
          <SettingsSection title={t("scope.unavailableLabel")}>
            <SettingsRow title={scope.message} />
          </SettingsSection>
        ) : environments.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Clock3Icon />
              </EmptyMedia>
              <EmptyTitle>{t("scheduled.noEnvironmentsAvailable")}</EmptyTitle>
              <EmptyDescription>
                {t("scheduled.connectAnEnvironmentToManageScheduledTasks")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : environments.length > 1 ? (
          <ScheduledTaskEnvironmentList
            key={`${target.environmentId ?? defaultEnvironment?.environmentId}:${target.taskId ?? ""}`}
            environmentId={target.environmentId ?? defaultEnvironment?.environmentId}
            taskId={target.taskId}
            onEdit={openForEdit}
          />
        ) : (
          <div className="space-y-8">
            {environments.map((entry) => (
              <ScheduledTaskEnvironmentSection
                key={`${entry.environmentId}:${target.taskId ?? ""}`}
                environment={entry}
                showEnvironmentHeading={environments.length > 1}
                taskId={
                  (target.environmentId ?? defaultEnvironment?.environmentId) ===
                  entry.environmentId
                    ? target.taskId
                    : undefined
                }
                onEdit={openForEdit}
              />
            ))}
          </div>
        )}
      </SettingsSection>
      {editor ? (
        <ScheduledTaskEditorDialog
          key={`${editor.environmentId}:${editor.task?.id ?? "new"}`}
          initialEnvironmentId={editor.environmentId}
          task={editor.task}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </SettingsPageContainer>
  );
}

const scheduledTasksListAtom = environmentAtomList("web-scheduled-tasks-list", (environmentId) =>
  serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
);

function ScheduledTaskEnvironmentList({
  environmentId,
  taskId,
  onEdit,
}: {
  readonly environmentId: EnvironmentId | undefined;
  readonly taskId: ScheduledTaskId | undefined;
  readonly onEdit: (environmentId: EnvironmentId, task: ScheduledTask) => void;
}) {
  const t = useTranslate();
  const { scope, environments } = useSettingsScope();
  const connectedIds = environments.flatMap((environment) =>
    environment.connection.phase === "connected" && environment.serverConfig !== null
      ? [environment.environmentId]
      : [],
  );
  const queries = useAtomValue(scheduledTasksListAtom(environmentIdsKey(connectedIds)));
  const states = environments.map((environment) => {
    const index = connectedIds.indexOf(environment.environmentId);
    const query = index < 0 ? null : queries[index]!;
    const data = query === null ? null : Option.getOrNull(AsyncResult.value(query));
    return {
      environment,
      connected: index >= 0,
      tasks: data?.tasks.filter((task) =>
        matchesScheduledTaskScope(scope, environment.environmentId, task.projectId),
      ),
      error: query?._tag === "Failure" ? formatEnvironmentQueryError(query.cause) : null,
    };
  });
  const linkedState = states.find((state) => state.environment.environmentId === environmentId);
  const linkedTask = linkedState?.tasks?.find((task) => task.id === taskId);
  const openedLink = useRef(false);
  useEffect(() => {
    if (!openedLink.current && environmentId && linkedTask) {
      openedLink.current = true;
      onEdit(environmentId, linkedTask);
    }
  }, [environmentId, linkedTask, onEdit]);

  const loaded = states.filter((state) => state.connected && state.error === null && state.tasks);
  const populated = loaded.filter((state) => state.tasks && state.tasks.length > 0);
  const summaries: Record<string, string[]> = {
    "scheduled.summary.disconnected": [],
    "scheduled.summary.loading": [],
    "scheduled.summary.failed": [],
    "scheduled.summary.empty": [],
  };
  for (const { environment, connected, tasks, error } of states) {
    const label = settingsScopeEnvironmentLabel(environment, environments);
    if (!connected) {
      summaries["scheduled.summary.disconnected"]!.push(
        `${label} (${connectionStatusTitle(environment.connection)})`,
      );
    } else if (error !== null) {
      summaries["scheduled.summary.failed"]!.push(`${label}: ${error}`);
    } else if (!tasks) {
      summaries["scheduled.summary.loading"]!.push(label);
    } else if (tasks.length === 0 && populated.length > 0) {
      summaries["scheduled.summary.empty"]!.push(label);
    }
  }

  return (
    <SettingsGroup>
      {populated.map(({ environment, tasks }) => {
        const { primary, secondary } = settingsScopeEnvironmentLabels(environment, environments);
        const transport = environmentTransportLabel(environment);
        return (
          <div key={environment.environmentId} className="divide-y divide-border/50">
            <EnvironmentRow
              kind={resolveEnvironmentMachineKind(environment.serverConfig)}
              label={primary}
              subtitle={
                <>
                  {secondary && secondary !== transport ? (
                    <span className="block truncate">{secondary}</span>
                  ) : null}
                  <span className="block truncate">{transport}</span>
                </>
              }
            >
              <ConnectionStatusDot
                dotClassName={connectionPhaseDotClassName(environment.connection.phase)}
                tooltipText={connectionStatusTitle(environment.connection)}
              />
              <span className="text-xs text-muted-foreground">
                {connectionStatusTitle(environment.connection)}
              </span>
            </EnvironmentRow>
            {tasks?.map((task) => (
              <ScheduledTaskRow
                key={task.id}
                environmentId={environment.environmentId}
                task={task}
                onEdit={() => onEdit(environment.environmentId, task)}
              />
            ))}
          </div>
        );
      })}
      {taskId && linkedState?.tasks && linkedState.error === null && !linkedTask ? (
        <SettingsRow
          title={t("scheduled.taskUnavailable")}
          description={t("scheduled.thisTaskNoLongerExistsOrIsOutside")}
          role="status"
        />
      ) : null}
      {populated.length === 0 && loaded.length > 0 ? (
        <SettingsRow
          title={t("scheduled.noScheduledTasks")}
          description={t("scheduled.noTasksMatchThisEnvironmentAndProjectSelection")}
        />
      ) : null}
      {Object.entries(summaries).map(([label, entries]) => {
        if (entries.length === 0) return null;
        const summary = t(label, { environments: entries.join(", ") });
        return (
          <Tooltip key={label}>
            <TooltipTrigger
              render={
                <p
                  className="truncate px-3 py-2.5 text-xs text-muted-foreground sm:px-4"
                  role="status"
                />
              }
            >
              {summary}
            </TooltipTrigger>
            <TooltipPopup>{summary}</TooltipPopup>
          </Tooltip>
        );
      })}
    </SettingsGroup>
  );
}

function ScheduledTaskEnvironmentSection({
  environment,
  showEnvironmentHeading,
  taskId,
  onEdit,
}: {
  readonly environment: EnvironmentPresentation;
  readonly showEnvironmentHeading: boolean;
  readonly taskId?: ScheduledTaskId | undefined;
  readonly onEdit: (environmentId: EnvironmentId, task: ScheduledTask) => void;
}) {
  const t = useTranslate();
  const { scope } = useSettingsScope();
  const connected =
    environment.connection.phase === "connected" && environment.serverConfig !== null;
  const tasksQuery = useEnvironmentQuery(
    connected
      ? serverEnvironment.scheduledTasksLive({
          environmentId: environment.environmentId,
          input: {},
        })
      : null,
  );
  const tasks = tasksQuery.data?.tasks.filter((task) =>
    matchesScheduledTaskScope(scope, environment.environmentId, task.projectId),
  );
  const linkedTask = tasks?.find((task) => task.id === taskId);
  const openedLink = useRef(false);
  useEffect(() => {
    if (!openedLink.current && linkedTask) {
      openedLink.current = true;
      onEdit(environment.environmentId, linkedTask);
    }
  }, [environment.environmentId, linkedTask, onEdit]);
  return (
    <SettingsSection
      title={environment.label}
      hideTitle={!showEnvironmentHeading}
      icon={
        <EnvironmentMachineIcon
          kind={resolveEnvironmentMachineKind(environment.serverConfig)}
          className="size-3.5"
        />
      }
    >
      {!connected ? (
        <SettingsRow
          title={t("chat.primary.disconnected")}
          description={t("scheduled.reconnectEnvironment", { environment: environment.label })}
        />
      ) : tasksQuery.error ? (
        <SettingsRow
          title={t("scheduled.couldNotLoadScheduledTasks")}
          description={tasksQuery.error}
        />
      ) : !tasks ? (
        <SettingsRow title={t("scheduled.loadingScheduledTasks")} role="status" />
      ) : (
        <>
          {taskId && !linkedTask ? (
            <SettingsRow
              title={t("scheduled.taskUnavailable")}
              description={t("scheduled.thisTaskNoLongerExistsOrIsOutside")}
              role="status"
            />
          ) : null}
          {tasks.length === 0 ? (
            <SettingsRow
              title={t("scheduled.noScheduledTasks")}
              description={t("scheduled.noTasksMatchThisEnvironmentAndProjectSelection")}
            />
          ) : (
            tasks.map((task) => (
              <ScheduledTaskRow
                key={task.id}
                environmentId={environment.environmentId}
                task={task}
                onEdit={() => onEdit(environment.environmentId, task)}
              />
            ))
          )}
        </>
      )}
    </SettingsSection>
  );
}

function ScheduledTaskRow({
  environmentId,
  task,
  onEdit,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: ScheduledTask;
  readonly onEdit: () => void;
}) {
  const t = useTranslate();
  const canOperate = useAtomValue(
    serverEnvironment.upsertScheduledTask.permissionAtom(environmentId),
  );
  const [busy, setBusy] = useState(false);
  const [deliveriesOpen, setDeliveriesOpen] = useState(false);
  const isWebhook = task.schedule.type === "webhook";
  const toggle = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    label: "scheduled task enabled",
  });
  const run = useAtomCommand(serverEnvironment.runScheduledTaskNow, {
    label: "scheduled task run now",
  });
  const remove = useAtomCommand(serverEnvironment.deleteScheduledTask, {
    label: "scheduled task delete",
  });
  const act = async (action: "toggle" | "run" | "delete") => {
    if (busy || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
    setBusy(true);
    const result =
      action === "toggle"
        ? await toggle({ environmentId, input: { id: task.id, enabled: !task.enabled } })
        : action === "run"
          ? await run({ environmentId, input: { id: task.id } })
          : await remove({ environmentId, input: { id: task.id } });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: t("scheduled.updateFailed"),
          description: String(squashAtomCommandFailure(result)),
        }),
      );
    }
  };
  return (
    <SettingsRow
      title={task.title}
      description={<span className="line-clamp-2">{task.prompt}</span>}
      status={
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {scheduleLabel(task.schedule, t)} ·{" "}
            {!task.enabled ? (
              t("scheduled.paused")
            ) : isWebhook ? (
              t("scheduled.listening")
            ) : task.nextRunAt ? (
              <>
                {t("scheduled.nextRun")} <ScheduledRelativeLabel value={task.nextRunAt} />
              </>
            ) : (
              t("scheduled.notScheduled")
            )}
          </span>
          {task.lastRunStatus !== "never" ? (
            <Badge variant={statusVariant(task.lastRunStatus)}>
              {t(`scheduled.status.${task.lastRunStatus}`)}
            </Badge>
          ) : null}
          {task.lastRunError ? <span className="text-destructive">{task.lastRunError}</span> : null}
        </div>
      }
      control={
        <div className="flex items-center gap-2">
          <Switch
            checked={task.enabled}
            disabled={busy || !canOperate}
            aria-label={t("scheduled.enableTask", { title: task.title })}
            onCheckedChange={() => void act("toggle")}
          />
          <Menu>
            <MenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy || !canOperate}
                  aria-label={t("scheduled.taskActions", { title: task.title })}
                />
              }
            >
              <MoreHorizontalIcon className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={onEdit}>
                <PencilIcon />
                {t("common.edit")}
              </MenuItem>
              {isWebhook ? (
                <MenuItem onClick={() => setDeliveriesOpen(true)}>
                  <InboxIcon />
                  {t("scheduled.deliveries")}
                </MenuItem>
              ) : (
                <MenuItem onClick={() => void act("run")}>
                  <PlayIcon />
                  {t("scheduled.runNow")}
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem onClick={() => void act("delete")}>
                <Trash2Icon />
                {t("common.delete")}
              </MenuItem>
            </MenuPopup>
          </Menu>
          {deliveriesOpen ? (
            <WebhookDeliveriesDialog
              environmentId={environmentId}
              task={task}
              onClose={() => setDeliveriesOpen(false)}
            />
          ) : null}
        </div>
      }
    />
  );
}

function WebhookDeliveriesDialog({
  environmentId,
  task,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: ScheduledTask;
  readonly onClose: () => void;
}) {
  const t = useTranslate();
  const deliveriesQuery = useEnvironmentQuery(
    serverEnvironment.scheduledTaskWebhookDeliveries({
      environmentId,
      input: { id: task.id, acceptAnyOutcome: true },
    }),
  );
  const [selectedId, setSelectedId] = useState<ScheduledTaskWebhookDeliverySummary["id"] | null>(
    null,
  );
  const selectedQuery = useEnvironmentQuery(
    selectedId === null
      ? null
      : serverEnvironment.scheduledTaskWebhookDelivery({
          environmentId,
          input: { id: task.id, deliveryId: selectedId, acceptAnyOutcome: true },
        }),
  );
  const deliveries = deliveriesQuery.data?.deliveries ?? null;
  const selected = selectedQuery.data?.delivery ?? null;
  const error = selectedId === null ? deliveriesQuery.error : selectedQuery.error;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("scheduled.deliveriesTitle", { title: task.title })}</DialogTitle>
          <DialogDescription>
            {t("scheduled.recentRequestsToThisTaskSWebhookUrl")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {selectedId !== null && selected === null && selectedQuery.error === null ? (
            <p className="text-sm text-muted-foreground" role="status">
              {t("scheduled.loadingDelivery")}
            </p>
          ) : selected ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge
                  variant={deliveryOutcomeVariant(
                    selected.pendingWindow ? "coalesced" : selected.outcome,
                  )}
                >
                  {webhookDeliveryLabel(selected, t)}
                </Badge>
                <span>
                  {selected.method} · <ScheduledRelativeLabel value={selected.receivedAt} />
                </span>
                {selected.signatureVerified ? (
                  <span className="text-muted-foreground">{t("scheduled.signatureVerified")}</span>
                ) : null}
              </div>
              {selected.error ? (
                <p
                  className={
                    selected.outcome === "filtered"
                      ? "text-sm text-muted-foreground"
                      : "text-sm text-destructive"
                  }
                >
                  {selected.error}
                </p>
              ) : null}
              <DeliveryBlock
                title={
                  selected.pendingWindow ? t("scheduled.scheduledRun") : t("scheduled.sentPrompt")
                }
              >
                {selected.renderedPrompt ??
                  (selected.pendingWindow ? t("scheduled.pendingRun") : t("scheduled.noRun"))}
              </DeliveryBlock>
              {selected.missingFields.length > 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("scheduled.emptyPlaceholders")} {selected.missingFields.join(", ")}
                </p>
              ) : null}
              <DeliveryBlock title={t("scheduled.headers")}>
                {Object.entries(selected.headers)
                  .map(([name, value]) => `${name}: ${value}`)
                  .join("\n")}
              </DeliveryBlock>
              {selected.query ? (
                <DeliveryBlock title={t("scheduled.query")}>{selected.query}</DeliveryBlock>
              ) : null}
              <DeliveryBlock
                title={selected.bodyTruncated ? t("scheduled.truncatedBody") : t("scheduled.body")}
              >
                {selected.body || t("scheduled.emptyBody")}
              </DeliveryBlock>
            </div>
          ) : selectedId !== null ? null : deliveries === null ? (
            <p className="text-sm text-muted-foreground" role="status">
              {t("scheduled.loadingDeliveries")}
            </p>
          ) : deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("scheduled.noRequestsYet")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {deliveries.map((delivery) => (
                <li key={delivery.id}>
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-2 py-2 text-left text-sm hover:bg-accent/40"
                    onClick={() => setSelectedId(delivery.id)}
                  >
                    <Badge
                      variant={deliveryOutcomeVariant(
                        delivery.pendingWindow ? "coalesced" : delivery.outcome,
                      )}
                    >
                      {webhookDeliveryLabel(delivery, t)}
                    </Badge>
                    <span>{delivery.method}</span>
                    <span className="text-muted-foreground">
                      <ScheduledRelativeLabel value={delivery.receivedAt} />
                    </span>
                    {delivery.outcome === "filtered" && delivery.error ? (
                      <span className="text-muted-foreground">{delivery.error}</span>
                    ) : null}
                    {delivery.missingFields.length > 0 ? (
                      <span className="text-muted-foreground">
                        {t("scheduled.emptyPlaceholderCount", {
                          count: delivery.missingFields.length,
                        })}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogPanel>
        <DialogFooter>
          {selectedId !== null ? (
            <Button variant="outline" size="sm" onClick={() => setSelectedId(null)}>
              {t("common.back")}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={deliveriesQuery.isPending}
              onClick={deliveriesQuery.refresh}
            >
              {t("convene.project.refresh")}
            </Button>
          )}
          <DialogClose render={<Button size="sm" />}>{t("common.done")}</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function DeliveryBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{title}</Label>
      <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap break-all">
        {children}
      </pre>
    </div>
  );
}

function WebhookEndpointField({
  environmentId,
  task,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: ScheduledTask | null;
}) {
  const t = useTranslate();
  const canRotate = useAtomValue(
    serverEnvironment.rotateScheduledTaskWebhookToken.permissionAtom(environmentId),
  );
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "webhook URL" });
  const rotate = useAtomCommand(serverEnvironment.rotateScheduledTaskWebhookToken, {
    label: "scheduled task rotate webhook token",
  });
  const [rotating, setRotating] = useState(false);
  const endpoint = task?.webhook;
  if (!task || !endpoint) {
    return (
      <p className="text-sm text-muted-foreground">{t("scheduled.theUrlAppearsAfterYouSave")}</p>
    );
  }
  const { address: url, copyable, note } = webhookAddress(endpoint, httpBaseUrl);
  const rotateUrl = async () => {
    const confirmed =
      (await requestConfirmDialog(t("scheduled.rotateConfirm"), {
        variant: "destructive",
      })) ?? window.confirm(t("scheduled.rotateConfirmInline"));
    if (!confirmed) return;
    setRotating(true);
    const result = await rotate({ environmentId, input: { id: task.id } });
    setRotating(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: t("scheduled.rotateFailed"),
          description: String(squashAtomCommandFailure(result)),
        }),
      );
    }
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Input
          readOnly
          aria-label={t("scheduled.webhookUrl")}
          value={url}
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          size="sm"
          variant="outline"
          type="button"
          disabled={!copyable}
          onClick={() => copyToClipboard(url, undefined)}
        >
          <CopyIcon />
          {isCopied ? t("common.copied") : t("common.copy")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          type="button"
          disabled={rotating || !canRotate}
          onClick={() => void rotateUrl()}
        >
          {t("integrations.viewport.rotate")}
        </Button>
      </div>
      {note !== null ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      {endpoint.url !== null ? <WebhookDeliveryMode environmentId={environmentId} /> : null}
    </div>
  );
}

function WebhookDeliveryMode({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const t = useTranslate();
  const cloudLink = usePrimaryCloudLinkState();
  if (cloudLink.target?.environmentId !== environmentId || cloudLink.data === null) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {cloudLink.data.holdWebhooksWhileOffline
        ? t("scheduled.heldWhileOffline")
        : t("scheduled.forwardedLive")}{" "}
      <Link to="/settings/connections" className="underline underline-offset-2">
        {t("scheduled.changeInConnections")}
      </Link>
    </p>
  );
}

function ScheduledTaskEditorDialog({
  initialEnvironmentId,
  task,
  onClose,
}: {
  readonly initialEnvironmentId: EnvironmentId;
  readonly task: ScheduledTask | null;
  readonly onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      {/* The form owns the draft so a keystroke re-renders it, not the dialog chrome. */}
      <DialogPopup className="max-w-xl">
        <ScheduledTaskEditorForm
          initialEnvironmentId={initialEnvironmentId}
          task={task}
          saving={saving}
          onSavingChange={setSaving}
          onClose={onClose}
        />
      </DialogPopup>
    </Dialog>
  );
}

function ScheduledTaskEditorForm({
  initialEnvironmentId,
  task,
  saving,
  onSavingChange: setSaving,
  onClose,
}: {
  readonly initialEnvironmentId: EnvironmentId;
  readonly task: ScheduledTask | null;
  readonly saving: boolean;
  readonly onSavingChange: (saving: boolean) => void;
  readonly onClose: () => void;
}) {
  const t = useTranslate();
  const { scope, connectedEnvironments } = useSettingsScope();
  const [environmentId, setEnvironmentId] = useState(initialEnvironmentId);
  const environment = useEnvironment(environmentId);
  const connected =
    environment?.connection.phase === "connected" && environment.serverConfig !== null;
  const tasksQuery = useEnvironmentQuery(
    connected ? serverEnvironment.scheduledTasksLive({ environmentId, input: {} }) : null,
  );
  const allProjects = useProjects();
  const projects = allProjects.filter(
    (project) =>
      project.environmentId === environmentId &&
      matchesScheduledTaskScope(scope, environmentId, project.id),
  );
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const canOperate = useAtomValue(
    serverEnvironment.upsertScheduledTask.permissionAtom(environmentId),
  );
  const upsertTask = useAtomCommand(serverEnvironment.upsertScheduledTask, {
    label: "scheduled task upsert",
  });
  const [draft, setDraft] = useState<DraftState>(() =>
    task ? taskToDraft(task) : { ...EMPTY_DRAFT, projectId: projects[0]?.id ?? "" },
  );
  const submissionPending = useRef(false);
  const editingTaskMissing =
    draft.editingId !== null &&
    tasksQuery.data !== null &&
    !tasksQuery.data.tasks.some((entry) => entry.id === draft.editingId);
  const liveTask = tasksQuery.data
    ? (tasksQuery.data.tasks.find((entry) => entry.id === draft.editingId) ?? null)
    : task;
  const selectedProjectId = draft.projectId || projects[0]?.id || "";
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(providers),
      settings,
      selectedProject?.id ?? null,
    ),
  );

  const firstInstance = instanceEntries[0];
  const draftSelection = draft.modelKey ? splitModelKey(draft.modelKey) : null;
  const activeSelection =
    draftSelection ?? scheduledTaskDefaultModel(settings, selectedProject ?? null, instanceEntries);
  const activeInstanceId =
    activeSelection?.instanceId ?? firstInstance?.instanceId ?? ("" as ProviderInstanceId);
  const activeModel = activeSelection?.model ?? "";
  const activeEntry = instanceEntries.find((entry) => entry.instanceId === activeInstanceId);
  const selectionUnavailable =
    activeSelection !== null &&
    (!activeEntry ||
      !activeEntry.enabled ||
      !activeEntry.installed ||
      !activeEntry.isAvailable ||
      activeEntry.snapshot.auth.status === "unauthenticated");
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    providers,
    activeInstanceId,
    activeModel,
  );

  const reportFailure = (title: string, error: unknown) => {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: error instanceof Error ? error.message : String(error),
      }),
    );
  };

  const submit = async () => {
    if (
      !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope) ||
      submissionPending.current ||
      saving ||
      editingTaskMissing ||
      !connected ||
      tasksQuery.data === null
    )
      return;
    const selection = activeSelection;
    if (
      !draft.title.trim() ||
      !draft.prompt.trim() ||
      !projects.some((project) => project.id === selectedProjectId) ||
      selection === null
    ) {
      reportFailure(t("scheduled.incomplete"), t("scheduled.completeRequiredFields"));
      return;
    }
    const parsedFilters = parseWebhookFilterDrafts(draft.filters, t);
    if (draft.scheduleMode === "webhook" && "error" in parsedFilters) {
      reportFailure(t("scheduled.invalidFilter"), parsedFilters.error);
      return;
    }
    const schedule = scheduleFromDraft(draft);
    if (schedule === null) {
      for (const error of webhookDraftErrors(draft, t))
        reportFailure(error.title, error.description);
      return;
    }
    if (
      schedule.type === "webhook" &&
      schedule.signature &&
      (!schedule.signature.header ||
        (!schedule.signature.secret &&
          !(liveTask?.schedule.type === "webhook" && liveTask.webhook?.hasSecret)))
    ) {
      reportFailure(t("scheduled.secretRequired"), t("scheduled.enterSignature"));
      return;
    }
    if (
      schedule.type === "interval" &&
      (!Number.isSafeInteger(schedule.everyMs) || schedule.everyMs < MIN_SCHEDULED_TASK_INTERVAL_MS)
    ) {
      reportFailure(t("scheduled.invalidInterval"), t("scheduled.minimumInterval"));
      return;
    }
    if (draft.workspaceMode === "existing_worktree" && !draft.existingWorktreePath.trim()) {
      reportFailure(t("scheduled.checkoutRequired"), t("scheduled.enterCheckout"));
      return;
    }
    const modelSelection =
      draft.baseModelSelection !== null &&
      draft.baseModelSelection.instanceId === selection.instanceId &&
      draft.baseModelSelection.model === selection.model
        ? draft.baseModelSelection
        : selection;
    const workspaceStrategy: OrchestrationV2ThreadLaunchWorkspaceStrategy =
      draft.workspaceMode === "root"
        ? { type: "root" }
        : draft.workspaceMode === "existing_worktree"
          ? { type: "existing_worktree", worktreePath: draft.existingWorktreePath.trim() }
          : {
              type: "worktree",
              baseRef: draft.baseRef.trim() || "main",
              startFromOrigin: draft.startFromOrigin,
            };
    const input: ScheduledTaskUpsertInput = {
      ...(draft.editingId ? { id: draft.editingId as ScheduledTaskId, requireExisting: true } : {}),
      title: draft.title.trim(),
      prompt: draft.prompt.trim(),
      enabled: draft.enabled,
      schedule,
      projectId: selectedProjectId as ProjectId,
      threadId: draft.threadId ? (draft.threadId as ThreadId) : null,
      workspaceStrategy,
      modelSelection,
      runtimeMode: draft.runtimeMode,
      interactionMode: draft.interactionMode,
      creationSource: "web",
    };
    // Lock before React renders, and keep successful creates locked until the form closes.
    submissionPending.current = true;
    setSaving(true);
    const result = await upsertTask({ environmentId, input });
    setSaving(false);
    if (result._tag === "Failure") {
      submissionPending.current = false;
      if (!isAtomCommandInterrupted(result)) {
        reportFailure(t("scheduled.saveFailed"), squashAtomCommandFailure(result));
      }
      return;
    }
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {draft.editingId ? t("scheduled.editTask") : t("scheduled.newTask")}
        </DialogTitle>
        <DialogDescription>
          {t("scheduled.runAPromptAutomaticallyOnAnIntervalAt")}
        </DialogDescription>
      </DialogHeader>

      <DialogPanel>
        {/* Fieldsets default to min-width: min-content, which lets one wide control widen the form past the dialog. */}
        <fieldset disabled={saving} className="min-w-0 space-y-5">
          {!connected ? (
            <p className="text-sm text-destructive">
              {t("scheduled.reconnectThisEnvironmentBeforeSaving")}
            </p>
          ) : null}
          <Field label={t("scheduled.runsOn")} htmlFor="scheduled-task-environment">
            <Select
              value={environmentId}
              disabled={task !== null || saving}
              onValueChange={(id) => {
                const next = connectedEnvironments.find((entry) => entry.environmentId === id);
                if (!next) return;
                setEnvironmentId(next.environmentId);
                setDraft((current) => ({
                  ...current,
                  projectId: "",
                  modelKey: "",
                  baseModelSelection: null,
                  baseRef: "main",
                  startFromOrigin: true,
                  existingWorktreePath: "",
                }));
              }}
            >
              <SelectTrigger id="scheduled-task-environment" size="sm">
                <SelectValue>
                  <span className="flex items-center gap-2">
                    <EnvironmentMachineIcon
                      kind={resolveEnvironmentMachineKind(environment?.serverConfig ?? null)}
                      className="size-4"
                    />
                    {environment?.label ?? t("scheduled.unavailableEnvironment")}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {connectedEnvironments.map((entry) => {
                  const { secondary } = settingsScopeEnvironmentLabels(
                    entry,
                    connectedEnvironments,
                  );
                  return (
                    <SelectItem
                      key={entry.environmentId}
                      value={entry.environmentId}
                      label={entry.label}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <EnvironmentMachineIcon
                          kind={resolveEnvironmentMachineKind(entry.serverConfig)}
                          className="size-4"
                        />
                        <span className="min-w-0">
                          <span className="block truncate">{entry.label}</span>
                          {secondary ? (
                            <span className="block max-w-72 truncate text-xs text-muted-foreground">
                              {secondary}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectPopup>
            </Select>
          </Field>
          {tasksQuery.error ? (
            <p className="text-sm text-destructive" role="status">
              {tasksQuery.error}
            </p>
          ) : null}
          {editingTaskMissing ? (
            <p className="text-xs text-destructive" role="status">
              {t("scheduled.thisScheduledTaskNoLongerExists")}
            </p>
          ) : null}
          <Field label={t("common.name")} htmlFor="scheduled-task-title">
            <Input
              id="scheduled-task-title"
              placeholder={t("scheduled.eGCheckForSentryIssues")}
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("common.project")} htmlFor="scheduled-task-project">
              <Select
                value={selectedProjectId}
                onValueChange={(projectId) =>
                  setDraft((current) => ({ ...current, projectId: projectId ?? "" }))
                }
              >
                <SelectTrigger size="sm" id="scheduled-task-project">
                  <SelectValue placeholder={t("scheduled.selectAProject")}>
                    {selectedProject?.title}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id} label={project.title}>
                      <span className="block truncate">{project.title}</span>
                      {allProjects.some(
                        (other) =>
                          other.title === project.title &&
                          (other.environmentId !== project.environmentId ||
                            other.id !== project.id),
                      ) ? (
                        <span className="block max-w-72 truncate text-xs text-muted-foreground">
                          {project.workspaceRoot}
                        </span>
                      ) : null}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </Field>

            <Field label={t("defaults.workspace.title")} htmlFor="scheduled-task-workspace">
              <Select
                value={draft.workspaceMode}
                onValueChange={(value) =>
                  setDraft((current) => ({ ...current, workspaceMode: value as WorkspaceMode }))
                }
              >
                <SelectTrigger size="sm" id="scheduled-task-workspace">
                  <SelectValue>{t(WORKSPACE_MODE_LABELS[draft.workspaceMode])}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="worktree">{t("scheduled.createANewWorktree")}</SelectItem>
                  <SelectItem value="root">{t("scheduled.useTheProjectCheckout")}</SelectItem>
                  <SelectItem value="existing_worktree">
                    {t("scheduled.useASpecificCheckout")}
                  </SelectItem>
                </SelectPopup>
              </Select>
            </Field>
          </div>

          {draft.workspaceMode === "worktree" ? (
            <Field label={t("scheduled.baseBranch")} htmlFor="scheduled-task-base-ref">
              <WorktreeBaseBranchPicker
                key={`${environmentId}:${selectedProjectId}`}
                id="scheduled-task-base-ref"
                environmentId={environmentId}
                cwd={selectedProject?.workspaceRoot ?? null}
                value={draft.baseRef}
                onValueChange={(baseRef) => setDraft((current) => ({ ...current, baseRef }))}
                startFromOrigin={draft.startFromOrigin}
                onStartFromOriginChange={(startFromOrigin) =>
                  setDraft((current) => ({ ...current, startFromOrigin }))
                }
                disabled={saving || !connected}
              />
            </Field>
          ) : null}
          {draft.workspaceMode === "existing_worktree" ? (
            <Field label={t("scheduled.checkoutPath")} htmlFor="scheduled-task-checkout">
              <Input
                id="scheduled-task-checkout"
                value={draft.existingWorktreePath}
                placeholder="/path/to/checkout"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    existingWorktreePath: event.target.value,
                  }))
                }
              />
            </Field>
          ) : null}

          <Field label={t("scheduled.prompt")} htmlFor="scheduled-task-prompt">
            <Textarea
              id="scheduled-task-prompt"
              className="max-h-64 overflow-y-auto"
              placeholder={t("scheduled.whatShouldTheAgentDoEachTimeThis")}
              value={draft.prompt}
              onChange={(event) =>
                setDraft((current) => ({ ...current, prompt: event.target.value }))
              }
            />
          </Field>

          <Field label={t("defaults.model.title")}>
            <div>
              <ProviderModelPicker
                environmentId={environmentId}
                disabled={saving || !connected}
                activeInstanceId={activeInstanceId}
                model={activeModel}
                lockedProvider={null}
                instanceEntries={instanceEntries}
                modelOptionsByInstance={modelOptionsByInstance}
                isComposerOwned={false}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                onInstanceModelChange={(instanceId, model) =>
                  setDraft((current) => ({ ...current, modelKey: `${instanceId}:${model}` }))
                }
              />
            </div>
            {selectionUnavailable ? (
              <p className="text-xs text-warning-foreground" role="status">
                {t("scheduled.providerUnavailable", { instanceId: activeInstanceId })}
              </p>
            ) : null}
          </Field>

          <div className="space-y-3">
            {task?.schedule.type === "interval" &&
            task.schedule.everyMs < MIN_SCHEDULED_TASK_INTERVAL_MS ? (
              <p className="text-sm text-muted-foreground" role="status">
                {t("scheduled.thisTaskUsesALegacyIntervalBelowOne")}
              </p>
            ) : null}
            {/* Wraps the toggle below the label when both don't fit, as on phones. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>{t("scheduled.schedule")}</Label>
              <ToggleGroup
                aria-label={t("thread.snooze.scheduleType")}
                value={[draft.scheduleMode]}
                onValueChange={(values) => {
                  const mode = values[0] as ScheduleMode | undefined;
                  if (mode === "fixed" || mode === "interval" || mode === "webhook")
                    setDraft((current) => ({
                      ...current,
                      scheduleMode: mode,
                      prompt:
                        mode === "webhook" && !current.prompt.trim()
                          ? DEFAULT_WEBHOOK_PROMPT
                          : current.prompt,
                    }));
                }}
              >
                <Toggle value="fixed">{t("scheduled.atATime")}</Toggle>
                <Toggle value="interval">{t("scheduled.everyInterval")}</Toggle>
                <Toggle value="webhook">{t("scheduled.onWebhook")}</Toggle>
              </ToggleGroup>
            </div>

            {draft.scheduleMode === "webhook" ? (
              <div className="space-y-4">
                <WebhookEndpointField environmentId={environmentId} task={liveTask} />
                <p className="text-xs text-muted-foreground">
                  {t("scheduled.webhookPromptHelp", {
                    bodyPath: "{{body.path}}",
                    header: "{{headers.name}}",
                    query: "{{query.name}}",
                    body: "{{body}}",
                    request: "{{request}}",
                  })}
                </p>
                <Field
                  label={t("scheduled.skipRequestsOlderThan")}
                  hint={t("scheduled.optionalMinutes")}
                  htmlFor="scheduled-task-max-age"
                >
                  <Input
                    id="scheduled-task-max-age"
                    type="number"
                    nativeInput
                    min={1}
                    max={MAX_WEBHOOK_DELIVERY_AGE_MINUTES}
                    placeholder={t("scheduled.runEveryRequest")}
                    value={draft.maxDeliveryAgeMinutes}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        maxDeliveryAgeMinutes: event.target.value,
                      }))
                    }
                  />
                </Field>
                <WebhookFiltersField
                  filters={draft.filters}
                  onChange={(filters) => setDraft((current) => ({ ...current, filters }))}
                />
                <Field
                  label={t("scheduled.replayKey")}
                  hint={t("scheduled.optionalTemplate")}
                  htmlFor="scheduled-task-replay-key"
                >
                  <Input
                    id="scheduled-task-replay-key"
                    placeholder="{{headers.delivery-id}}"
                    value={draft.replayKey}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, replayKey: event.target.value }))
                    }
                  />
                </Field>
                <Field
                  label={t("scheduled.coalesceKey")}
                  hint={t("scheduled.optionalTemplate")}
                  htmlFor="scheduled-task-coalesce-key"
                >
                  <Input
                    id="scheduled-task-coalesce-key"
                    placeholder="{{body.id}}"
                    value={draft.coalesceKey}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, coalesceKey: event.target.value }))
                    }
                  />
                </Field>
                <Field
                  label={t("scheduled.coalesceWindow")}
                  hint={t("scheduled.windowSeconds")}
                  htmlFor="scheduled-task-coalesce-window"
                >
                  <Input
                    id="scheduled-task-coalesce-window"
                    type="number"
                    nativeInput
                    min={10}
                    max={3600}
                    placeholder="120"
                    value={draft.coalesceWindowSeconds}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        coalesceWindowSeconds: event.target.value,
                      }))
                    }
                  />
                </Field>
                <p className="text-xs text-muted-foreground">
                  {t("scheduled.replayKeysSuppressRepeatDeliveriesFor7Days")}
                </p>
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <Label htmlFor="scheduled-task-signature">
                      {t("scheduled.requireSignature")}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {t("scheduled.rejectRequestsWithoutAValidHmacSha256Signature")}
                    </p>
                  </div>
                  <Switch
                    id="scheduled-task-signature"
                    checked={draft.signatureEnabled}
                    onCheckedChange={(signatureEnabled) =>
                      setDraft((current) => ({ ...current, signatureEnabled }))
                    }
                  />
                </div>
                {draft.signatureEnabled ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t("scheduled.header")} htmlFor="scheduled-task-signature-header">
                      <Input
                        id="scheduled-task-signature-header"
                        value={draft.signatureHeader}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            signatureHeader: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label={t("scheduled.prefix")} htmlFor="scheduled-task-signature-prefix">
                      <Input
                        id="scheduled-task-signature-prefix"
                        value={draft.signaturePrefix}
                        placeholder={t("pullRequest.detail.none")}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            signaturePrefix: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field
                      label={t("scheduled.encoding")}
                      htmlFor="scheduled-task-signature-encoding"
                    >
                      <Select
                        value={draft.signatureEncoding}
                        onValueChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            signatureEncoding: value === "base64" ? "base64" : "hex",
                          }))
                        }
                      >
                        <SelectTrigger size="sm" id="scheduled-task-signature-encoding">
                          <SelectValue>{draft.signatureEncoding}</SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          <SelectItem value="hex">hex</SelectItem>
                          <SelectItem value="base64">base64</SelectItem>
                        </SelectPopup>
                      </Select>
                    </Field>
                    <Field label={t("scheduled.secret")} htmlFor="scheduled-task-signature-secret">
                      <Input
                        id="scheduled-task-signature-secret"
                        type="password"
                        autoComplete="off"
                        value={draft.signatureSecret}
                        placeholder={
                          liveTask?.schedule.type === "webhook" && liveTask.webhook?.hasSecret
                            ? t("scheduled.unchangedSecret")
                            : t("scheduled.sharedSecret")
                        }
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            signatureSecret: event.target.value,
                          }))
                        }
                      />
                    </Field>
                  </div>
                ) : null}
              </div>
            ) : draft.scheduleMode === "fixed" ? (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Label htmlFor="scheduled-task-time">{t("scheduled.runAt")}</Label>
                  <Input
                    type="time"
                    id="scheduled-task-time"
                    nativeInput
                    className="w-32"
                    value={draft.timeOfDay}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, timeOfDay: event.target.value }))
                    }
                  />
                  <span className="text-xs text-muted-foreground">{t("scheduled.on")}</span>
                </div>
                <ToggleGroup
                  multiple
                  variant="outline"
                  size="sm"
                  aria-label={t("scheduled.daysToRun")}
                  value={[...draft.weekdays].map(String)}
                  onValueChange={(values) => {
                    if (values.length === 0) return;
                    setDraft((current) => ({
                      ...current,
                      weekdays: new Set(values.map(Number)),
                    }));
                  }}
                >
                  {WEEKDAY_ORDER.map((day) => (
                    <Toggle
                      key={day}
                      value={String(day)}
                      aria-label={t(`scheduled.weekday.${WEEKDAY_LABELS[day]}`)}
                    >
                      {t(`scheduled.weekdayShort.${WEEKDAY_LABELS[day]}`)}
                    </Toggle>
                  ))}
                </ToggleGroup>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Label htmlFor="scheduled-task-interval">{t("scheduled.runEvery")}</Label>
                <Input
                  type="number"
                  id="scheduled-task-interval"
                  nativeInput
                  min={1}
                  step="any"
                  className="w-24"
                  value={draft.intervalMinutes}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, intervalMinutes: event.target.value }))
                  }
                />
                <span className="text-xs text-muted-foreground">{t("scheduled.minutes")}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="scheduled-task-enabled">{t("common.enabled")}</Label>
              <p id="scheduled-task-enabled-description" className="text-sm text-muted-foreground">
                {t("scheduled.disabledTasksStaySavedButDoNotRun")}
              </p>
            </div>
            <Switch
              id="scheduled-task-enabled"
              aria-describedby="scheduled-task-enabled-description"
              checked={draft.enabled}
              onCheckedChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
            />
          </div>
        </fieldset>
      </DialogPanel>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" size="sm" disabled={saving} />}>
          {t("common.cancel")}
        </DialogClose>
        <Button
          size="sm"
          disabled={!canOperate || saving || editingTaskMissing || !connected || !tasksQuery.data}
          onClick={() => void submit()}
        >
          {draft.editingId ? t("scheduled.saveTask") : t("scheduled.createTask")}
        </Button>
      </DialogFooter>
    </>
  );
}
