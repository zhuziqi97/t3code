import { useTranslate } from "../../i18n";
import type { ConveneMcpScope, ConveneProjectOptions, EnvironmentId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useState } from "react";
import { FolderIcon, LayersIcon } from "lucide-react";
import { conveneEnvironment } from "~/state/convene";
import { useAtomCommand } from "~/state/use-atom-command";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "../ui/select";

type Options = typeof ConveneProjectOptions.Type;
type Option = Options["items"][number];
type Scope = ReadonlyArray<typeof ConveneMcpScope.Type>;
export function ConveneModulePicker({
  environmentId,
  initialScope,
  initialNames,
  boundModuleIds,
  onScope,
  onModule,
  onClose,
}: {
  environmentId: EnvironmentId;
  initialScope: Scope;
  initialNames?: Record<string, string>;
  boundModuleIds?: ReadonlyArray<string>;
  onScope?: (value: Scope, names: Record<string, string>) => void;
  onModule?: (moduleId: string) => void;
  onClose: () => void;
}) {
  const t = useTranslate();
  const options = useAtomCommand(conveneEnvironment.projectOptions, { reportFailure: false });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [requestedSearch, setRequestedSearch] = useState("");
  const [project, setProject] = useState<Option | null>(null);
  const [projectResponse, setProjectResponse] = useState<{
    environmentId: EnvironmentId;
    page: number;
    search: string;
    translate: typeof t;
    result: Options | null;
    error: string | null;
  } | null>(null);
  const [moduleResponse, setModuleResponse] = useState<{
    environmentId: EnvironmentId;
    project: Option;
    translate: typeof t;
    result: Options | null;
    error: string | null;
  } | null>(null);
  const [scope, setScope] = useState<Scope>(initialScope);
  const [moduleSearch, setModuleSearch] = useState("");
  const [moduleId, setModuleId] = useState<string | null>(null);
  const [names, setNames] = useState(initialNames ?? {});
  const currentProjects =
    projectResponse?.environmentId === environmentId &&
    projectResponse.page === page &&
    projectResponse.search === requestedSearch &&
    projectResponse.translate === t
      ? projectResponse
      : null;
  const currentModuleResponse =
    moduleResponse?.environmentId === environmentId &&
    moduleResponse.project === project &&
    moduleResponse.translate === t
      ? moduleResponse
      : null;
  const projects = currentProjects?.result ?? null;
  const projectError = currentProjects?.error ?? null;
  const modules = currentModuleResponse?.result ?? null;
  const moduleError = currentModuleResponse?.error ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Project queries follow the destination environment and filter; cleanup rejects stale replies.
  useEffect(() => {
    let active = true;
    void options({ environmentId, input: { page, search: requestedSearch } }).then((result) => {
      if (!active) return;
      if (result._tag === "Failure") {
        const cause = squashAtomCommandFailure(result);
        setProjectResponse({
          environmentId,
          page,
          search: requestedSearch,
          translate: t,
          result: null,
          error: cause instanceof Error ? cause.message : t("convene.error.options"),
        });
      } else {
        setProjectResponse({
          environmentId,
          page,
          search: requestedSearch,
          translate: t,
          result: result.value,
          error: null,
        });
        setProject((current) => current ?? result.value.items[0] ?? null);
      }
    });
    return () => {
      active = false;
    };
  }, [environmentId, options, page, requestedSearch, t]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Selected platform projects load remote module permissions with cancellation on cleanup.
  useEffect(() => {
    let active = true;
    if (project)
      void options({ environmentId, input: { projectId: project.id, page: 1, search: "" } }).then(
        (result) => {
          if (!active) return;
          if (result._tag === "Failure") {
            const cause = squashAtomCommandFailure(result);
            setModuleResponse({
              environmentId,
              project,
              translate: t,
              result: null,
              error: cause instanceof Error ? cause.message : t("convene.error.options"),
            });
          } else {
            setModuleResponse({
              environmentId,
              project,
              translate: t,
              result: result.value,
              error: null,
            });
            setNames((previous) => ({
              ...previous,
              ...Object.fromEntries(
                result.value.items.map((item) => [
                  item.id,
                  `${project.display_name ?? project.name} / ${item.display_name ?? item.name}`,
                ]),
              ),
            }));
          }
        },
      );
    return () => {
      active = false;
    };
  }, [environmentId, options, project, t]);
  const update = (moduleId: string, permission: "READ" | "WRITE" | null) =>
    setScope((previous) => [
      ...previous.filter((entry) => entry.module_id !== moduleId),
      ...(permission ? [{ module_id: moduleId, permission }] : []),
    ]);
  const query = moduleSearch.trim().toLocaleLowerCase();
  const currentModules = (modules?.items ?? []).filter(
    (item) =>
      !query || `${item.name} ${item.display_name ?? ""}`.toLocaleLowerCase().includes(query),
  );
  const currentSelection = currentModules.flatMap((item) => {
    const selected = scope.find((entry) => entry.module_id === item.id);
    return selected ? [{ ...item, permission: selected.permission }] : [];
  });
  const allSelected =
    currentModules.length > 0 && currentSelection.length === currentModules.length;
  const bulkPermission =
    currentSelection.length > 0 &&
    currentSelection.every((item) => item.permission === currentSelection[0]?.permission)
      ? [currentSelection[0]!.permission]
      : [];
  const selectAll = (selected: boolean) =>
    setScope((previous) => {
      const choices = new Map(previous.map((entry) => [entry.module_id, entry.permission]));
      for (const item of currentModules) {
        if (!selected) choices.delete(item.id);
        else if (!choices.has(item.id)) choices.set(item.id, "READ");
      }
      return Array.from(choices, ([module_id, permission]) => ({ module_id, permission }));
    });
  const setPermission = (permission: "READ" | "WRITE") =>
    setScope((previous) =>
      previous.map((entry) => {
        const item = currentModules.find((item) => item.id === entry.module_id);
        return item
          ? { ...entry, permission: permission === "WRITE" && item.can_write ? "WRITE" : "READ" }
          : entry;
      }),
    );
  const error = projectError ?? moduleError;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {onScope ? t("convene.scope.title") : t("convene.scope.bindTitle")}
          </DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            {error && (
              <Alert variant="error">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="grid overflow-hidden rounded-lg border sm:grid-cols-[200px_minmax(0,1fr)]">
              <aside className="space-y-3 border-b bg-muted/30 p-3 sm:border-r sm:border-b-0">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("convene.scope.projectLabel")}
                </p>
                <form
                  className="flex gap-1"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (search !== requestedSearch || page !== 1) {
                      setProject(null);
                      setModuleId(null);
                    }
                    setRequestedSearch(search);
                    setPage(1);
                  }}
                >
                  <Input
                    aria-label={t("convene.scope.searchLabel")}
                    placeholder={t("convene.scope.searchLabel")}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="min-w-0"
                  />
                  <Button type="submit" size="sm">
                    {t("convene.scope.search")}
                  </Button>
                </form>
                {!projects && !projectError && (
                  <p role="status" className="text-sm text-muted-foreground">
                    {t("convene.scope.loading")}
                  </p>
                )}
                <div className="max-h-32 space-y-1 overflow-y-auto sm:max-h-72">
                  {projects?.items.map((item) => (
                    <Button
                      key={item.id}
                      variant={project?.id === item.id ? "secondary" : "ghost"}
                      title={item.display_name ?? item.name}
                      aria-pressed={project?.id === item.id}
                      className="w-full justify-start"
                      onClick={() => {
                        if (project?.id !== item.id) {
                          setModuleResponse(null);
                          setModuleSearch("");
                          setModuleId(null);
                          setProject(item);
                        }
                      }}
                    >
                      <FolderIcon className="size-4 shrink-0" />
                      <span className="truncate">{item.display_name ?? item.name}</span>
                    </Button>
                  ))}
                  {projects?.items.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t("convene.scope.emptyProjects")}
                    </p>
                  )}
                </div>
                {projects && (page > 1 || page * 20 < projects.total) && (
                  <div className="flex items-center justify-between gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={page === 1}
                      onClick={() => {
                        setProject(null);
                        setModuleId(null);
                        setPage(page - 1);
                      }}
                    >
                      {t("convene.scope.previous")}
                    </Button>
                    <span className="text-xs text-muted-foreground">{page}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={page * 20 >= projects.total}
                      onClick={() => {
                        setProject(null);
                        setModuleId(null);
                        setPage(page + 1);
                      }}
                    >
                      {t("convene.scope.next")}
                    </Button>
                  </div>
                )}
              </aside>
              <section className="min-w-0 space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {t("convene.scope.modulesLabel")}
                    </p>
                    <Tooltip>
                      <TooltipTrigger
                        render={<h3 className="truncate text-sm font-medium" tabIndex={0} />}
                      >
                        {project
                          ? (project.display_name ?? project.name)
                          : t("convene.scope.chooseProject")}
                      </TooltipTrigger>
                      <TooltipPopup>
                        {project
                          ? (project.display_name ?? project.name)
                          : t("convene.scope.chooseProject")}
                      </TooltipPopup>
                    </Tooltip>
                  </div>
                  {onScope && (
                    <div className="flex items-center gap-3">
                      <label className="flex cursor-pointer items-center gap-2 text-xs">
                        <Checkbox
                          checked={allSelected}
                          indeterminate={currentSelection.length > 0 && !allSelected}
                          disabled={currentModules.length === 0}
                          onCheckedChange={selectAll}
                        />
                        {t("convene.scope.selectAll")}
                      </label>
                      <ToggleGroup
                        variant="segmented"
                        value={bulkPermission}
                        onValueChange={(values) => {
                          const permission = values[0];
                          if (permission === "READ" || permission === "WRITE")
                            setPermission(permission);
                        }}
                      >
                        <Toggle
                          value="READ"
                          aria-label={t("convene.scope.allRead")}
                          disabled={currentSelection.length === 0}
                        >
                          {t("convene.permission.read")}
                        </Toggle>
                        <Toggle
                          value="WRITE"
                          aria-label={t("convene.scope.allWrite")}
                          disabled={!currentSelection.some((item) => item.can_write)}
                        >
                          {t("convene.permission.writeOption")}
                        </Toggle>
                      </ToggleGroup>
                    </div>
                  )}
                </div>
                {project && (
                  <Input
                    aria-label={t("convene.scope.searchModules")}
                    placeholder={t("convene.scope.searchModules")}
                    value={moduleSearch}
                    onChange={(event) => setModuleSearch(event.target.value)}
                  />
                )}
                {project && !modules && !moduleError && (
                  <p role="status" className="text-sm text-muted-foreground">
                    {t("convene.scope.loading")}
                  </p>
                )}
                <div
                  className={
                    onScope
                      ? "max-h-52 space-y-2 overflow-y-auto"
                      : "max-h-72 space-y-2 overflow-y-auto"
                  }
                >
                  {currentModules.map((item) => {
                    const selected = scope.find((entry) => entry.module_id === item.id);
                    const bound = boundModuleIds?.includes(item.id);
                    return onScope ? (
                      <div
                        key={item.id}
                        className="flex min-h-10 items-center gap-3 rounded-lg border px-3 py-1.5"
                      >
                        <Checkbox
                          aria-label={t("convene.scope.access", {
                            module: item.display_name ?? item.name,
                          })}
                          checked={selected !== undefined}
                          onCheckedChange={(checked) => update(item.id, checked ? "READ" : null)}
                        />
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span className="min-w-0 flex-1 truncate text-sm" tabIndex={0} />
                            }
                          >
                            {item.display_name ?? item.name}
                          </TooltipTrigger>
                          <TooltipPopup>{item.display_name ?? item.name}</TooltipPopup>
                        </Tooltip>
                        {selected && (
                          <Select
                            value={selected.permission}
                            items={[
                              { value: "READ", label: t("convene.permission.read") },
                              { value: "WRITE", label: t("convene.permission.writeOption") },
                            ]}
                            onValueChange={(value) => {
                              if (value) update(item.id, value);
                            }}
                          >
                            <SelectTrigger
                              size="sm"
                              aria-label={t("convene.scope.permission", {
                                module: item.display_name ?? item.name,
                              })}
                              className="w-24"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectPopup>
                              <SelectItem value="READ">{t("convene.permission.read")}</SelectItem>
                              <SelectItem value="WRITE" disabled={!item.can_write}>
                                {t("convene.permission.writeOption")}
                              </SelectItem>
                            </SelectPopup>
                          </Select>
                        )}
                      </div>
                    ) : (
                      <Button
                        key={item.id}
                        variant={moduleId === item.id ? "secondary" : "outline"}
                        className="w-full justify-start"
                        title={item.display_name ?? item.name}
                        aria-pressed={moduleId === item.id}
                        disabled={bound || !item.can_write}
                        onClick={() => setModuleId(item.id)}
                      >
                        <LayersIcon className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-left">
                          {item.display_name ?? item.name}
                        </span>
                        {bound ? (
                          <span className="text-xs">{t("convene.scope.bound")}</span>
                        ) : !item.can_write ? (
                          <span className="text-xs">{t("convene.permission.read")}</span>
                        ) : null}
                      </Button>
                    );
                  })}
                  {modules && currentModules.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t(query ? "convene.scope.noMatchingModules" : "convene.scope.emptyModules")}
                    </p>
                  )}
                  {modules?.truncated && (
                    <p role="status" className="text-sm text-muted-foreground">
                      {t("convene.scope.truncated")}
                    </p>
                  )}
                </div>
              </section>
            </div>
            {onScope && (
              <section className="space-y-2">
                <p className="text-sm font-medium">
                  {t("convene.scope.selected", { count: scope.length })}
                </p>
                {scope.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("convene.scope.emptySelection")}
                  </p>
                )}
                <div className="max-h-28 space-y-1 overflow-y-auto">
                  {scope.map((entry) => (
                    <div
                      key={entry.module_id}
                      className="flex items-center gap-2 rounded-md bg-muted/30 px-3 py-1"
                    >
                      <Tooltip>
                        <TooltipTrigger
                          render={<span className="min-w-0 flex-1 truncate text-xs" tabIndex={0} />}
                        >
                          {names[entry.module_id] ?? t("convene.scope.selectedModule")} ·{" "}
                          {t(
                            entry.permission === "WRITE"
                              ? "convene.permission.write"
                              : "convene.permission.read",
                          )}
                        </TooltipTrigger>
                        <TooltipPopup>
                          {names[entry.module_id] ?? t("convene.scope.selectedModule")}
                        </TooltipPopup>
                      </Tooltip>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t("convene.scope.removeNamed", {
                          module: names[entry.module_id] ?? t("convene.scope.selectedModule"),
                        })}
                        onClick={() => update(entry.module_id, null)}
                      >
                        {t("convene.scope.remove")}
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("convene.scope.cancel")}
          </Button>
          {onModule && (
            <Button
              disabled={moduleId === null}
              onClick={() => {
                if (moduleId) onModule(moduleId);
                onClose();
              }}
            >
              {t("convene.scope.bindConfirm")}
            </Button>
          )}
          {onScope && (
            <Button
              onClick={() => {
                onScope(scope, names);
                onClose();
              }}
            >
              {t("convene.scope.apply")}
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
