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
        setError(
          cause instanceof Error ? cause.message : "Could not load platform projects and modules.",
        );
      } else if (project) setModules(result.value);
      else setProjects(result.value);
    });
    return () => {
      active = false;
    };
  }, [environmentId, options, page, project, requestedSearch]);
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
          <DialogTitle>{onScope ? "MCP module access" : "Associate a Convene module"}</DialogTitle>
          <DialogDescription>
            {onScope
              ? "Choose modules from any platform project. This scope is independent of execution associations. Apply updates the draft; Save MCP configuration commits it."
              : "A project can be associated with several modules. Association does not activate a client or change MCP access."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            {error && (
              <Alert variant="error">
                <AlertDescription>{error}</AlertDescription>
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
                Back to platform projects
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
                  aria-label="Search platform projects"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <Button type="submit">Search</Button>
              </form>
            )}
            {busy && (
              <p role="status" className="text-sm text-muted-foreground">
                Loading…
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
                  <p className="text-sm text-muted-foreground">No accessible projects.</p>
                )}
                <div className="flex items-center justify-between gap-2">
                  <Button variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>
                    Previous
                  </Button>
                  <span className="text-xs text-muted-foreground">Page {page}</span>
                  <Button
                    variant="ghost"
                    disabled={page * 20 >= projects.total}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
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
                        aria-label={`Access ${item.display_name ?? item.name}`}
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
                            { value: "READ", label: "Read" },
                            { value: "WRITE", label: "Write" },
                          ]}
                          onValueChange={(value) => {
                            if (value) update(item.id, value);
                          }}
                        >
                          <SelectTrigger
                            size="sm"
                            aria-label={`Permission for ${item.display_name ?? item.name}`}
                            className="w-28"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectPopup>
                            <SelectItem value="READ">Read</SelectItem>
                            <SelectItem value="WRITE" disabled={!item.can_write}>
                              Write
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
                  <p className="text-sm text-muted-foreground">
                    No accessible modules in this project.
                  </p>
                )}
                {modules.truncated && (
                  <p role="status" className="text-sm text-muted-foreground">
                    The platform limits the module list. Manage modules in Convene if the required
                    module is not listed.
                  </p>
                )}
              </div>
            )}
            {onScope && (
              <div className="space-y-2">
                <p className="text-sm">Selected modules ({scope.length})</p>
                {scope.map((entry) => (
                  <div key={entry.module_id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {entry.module_id} · {entry.permission}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => update(entry.module_id, null)}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {onScope && (
            <Button
              onClick={() => {
                onScope(scope);
                onClose();
              }}
            >
              Apply to draft
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
