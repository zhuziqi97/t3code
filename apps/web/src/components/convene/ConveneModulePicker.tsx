import { useTranslate } from "../../i18n";
import type { ConveneMcpScope, ConveneProjectOptions, EnvironmentId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useState } from "react";
import { conveneEnvironment } from "~/state/convene";
import { useAtomCommand } from "~/state/use-atom-command";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "../ui/select";

type Options = typeof ConveneProjectOptions.Type;
type Scope = ReadonlyArray<typeof ConveneMcpScope.Type>;
export function ConveneModulePicker({
  environmentId,
  initialScope,
  onScope,
  onModule,
  onClose,
}: {
  environmentId: EnvironmentId;
  initialScope: Scope;
  onScope?: (value: Scope) => void;
  onModule?: (moduleId: string) => void;
  onClose: () => void;
}) {
  const t = useTranslate();
  const options = useAtomCommand(conveneEnvironment.projectOptions, { reportFailure: false });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [requestedSearch, setRequestedSearch] = useState("");
  const [project, setProject] = useState<string | null>(null);
  const [projects, setProjects] = useState<Options | null>(null);
  const [modules, setModules] = useState<Options | null>(null);
  const [scope, setScope] = useState<Scope>(initialScope);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError(null);
    if (project) setModules(null);
    else setProjects(null);
    void options({
      environmentId,
      input: { ...(project ? { projectId: project } : {}), page, search: requestedSearch },
    }).then((result) => {
      if (!active) return;
      setBusy(false);
      if (result._tag === "Failure") {
        const cause = squashAtomCommandFailure(result);
        setError(cause instanceof Error ? cause.message : t("convene.error.options"));
      } else if (project) setModules(result.value);
      else setProjects(result.value);
    });
    return () => {
      active = false;
    };
  }, [environmentId, options, page, project, requestedSearch, t]);
  const update = (moduleId: string, permission: "READ" | "WRITE" | null) =>
    setScope((previous) => [
      ...previous.filter((entry) => entry.module_id !== moduleId),
      ...(permission ? [{ module_id: moduleId, permission }] : []),
    ]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            {onScope ? t("convene.scope.title") : t("convene.scope.bindTitle")}
          </DialogTitle>
          <DialogDescription>
            {onScope ? t("convene.scope.description") : t("convene.scope.bindDescription")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            {error && (
              <Alert variant="error">
                <AlertDescription>
                  <p>{t("convene.error.options")}</p>
                  <p>{error}</p>
                </AlertDescription>
              </Alert>
            )}
            {project ? (
              <Button
                variant="outline"
                onClick={() => {
                  setProject(null);
                  setPage(1);
                }}
              >
                {t("convene.scope.back")}
              </Button>
            ) : (
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  setRequestedSearch(search);
                  setPage(1);
                }}
              >
                <Input
                  aria-label={t("convene.scope.searchLabel")}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <Button type="submit">{t("convene.scope.search")}</Button>
              </form>
            )}
            {busy && (
              <p role="status" className="text-sm text-muted-foreground">
                {t("convene.scope.loading")}
              </p>
            )}
            {!project && projects && (
              <div className="space-y-2">
                {projects.items.map((item) => (
                  <Button
                    key={item.id}
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => {
                      setProject(item.id);
                      setPage(1);
                    }}
                  >
                    {item.display_name ?? item.name}
                  </Button>
                ))}
                {projects.items.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("convene.scope.emptyProjects")}
                  </p>
                )}
                <div className="flex items-center justify-between gap-2">
                  <Button variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>
                    {t("convene.scope.previous")}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {t("convene.scope.page", { page })}
                  </span>
                  <Button
                    variant="ghost"
                    disabled={page * 20 >= projects.total}
                    onClick={() => setPage(page + 1)}
                  >
                    {t("convene.scope.next")}
                  </Button>
                </div>
              </div>
            )}
            {project && modules && (
              <div className="space-y-3">
                {modules.items.map((item) => {
                  const selected = scope.find((entry) => entry.module_id === item.id);
                  return onScope ? (
                    <div key={item.id} className="flex items-center gap-3">
                      <Checkbox
                        aria-label={t("convene.scope.access", {
                          module: item.display_name ?? item.name,
                        })}
                        checked={selected !== undefined}
                        onCheckedChange={(checked) => update(item.id, checked ? "READ" : null)}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {item.display_name ?? item.name}
                      </span>
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
                            className="w-28"
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
                      variant="outline"
                      className="w-full justify-start"
                      onClick={() => {
                        onModule?.(item.id);
                        onClose();
                      }}
                    >
                      {item.display_name ?? item.name}
                    </Button>
                  );
                })}
                {modules.items.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t("convene.scope.emptyModules")}</p>
                )}
                {modules.truncated && (
                  <p role="status" className="text-sm text-muted-foreground">
                    {t("convene.scope.truncated")}
                  </p>
                )}
              </div>
            )}
            {onScope && (
              <div className="space-y-2">
                <p className="text-sm">{t("convene.scope.selected", { count: scope.length })}</p>
                {scope.map((entry) => (
                  <div key={entry.module_id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {entry.module_id} ·{" "}
                      {entry.permission === "WRITE"
                        ? t("convene.permission.write")
                        : t("convene.permission.read")}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => update(entry.module_id, null)}>
                      {t("convene.scope.remove")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("convene.scope.cancel")}
          </Button>
          {onScope && (
            <Button
              onClick={() => {
                onScope(scope);
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
