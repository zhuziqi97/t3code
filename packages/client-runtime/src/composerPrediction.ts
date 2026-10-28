import type {
  ComposerPredictionInput,
  ComposerPredictionCancelInput,
  ComposerPredictionResult,
  EnvironmentId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { threadRuntimeIsActive, type EnvironmentThreadShell } from "./state/models.ts";

export interface PredictionContext {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerInstanceId: ProviderInstanceId;
  readonly providerThreadId: string | null;
  readonly connectionGeneration: number;
  readonly sourceRunId: RunId | null;
  readonly enabled: boolean;
  readonly available: boolean;
  readonly idle: boolean;
  readonly sourceActive: boolean;
  readonly draftRevision: number;
  readonly draftEmpty: boolean;
}

export function threadPredictionContext(
  thread: EnvironmentThreadShell | null,
  options: {
    readonly enabled: boolean;
    readonly connected: boolean;
    readonly connectionGeneration: number;
    readonly permitted: boolean;
    readonly codex: boolean;
    readonly selectedInstanceId: ProviderInstanceId;
    readonly blocked: boolean;
    readonly draftEmpty: boolean;
    readonly draftRevision: number;
  },
): PredictionContext | null {
  if (!thread) return null;
  return {
    environmentId: thread.environmentId,
    threadId: thread.id,
    providerInstanceId: thread.providerInstanceId,
    providerThreadId: thread.activeProviderThreadId,
    connectionGeneration: options.connectionGeneration,
    sourceRunId: thread.latestRun?.runId ?? null,
    enabled: options.enabled,
    available:
      options.connected &&
      options.permitted &&
      options.codex &&
      options.selectedInstanceId === thread.providerInstanceId &&
      thread.lineage.relationshipToParent !== "subagent",
    sourceActive: threadRuntimeIsActive(thread.runtime),
    idle:
      !options.blocked &&
      !threadRuntimeIsActive(thread.runtime) &&
      thread.latestRun?.status === "completed" &&
      !thread.hasPendingApprovals &&
      !thread.hasPendingUserInput &&
      thread.pendingBackgroundTasks.length === 0,
    draftEmpty: options.draftEmpty,
    draftRevision: options.draftRevision,
  };
}

type PredictionView =
  | { readonly status: "idle" | "pending"; readonly text: null }
  | { readonly status: "suggestion"; readonly text: string };
const IDLE: PredictionView = { status: "idle", text: null };

function eligible(
  context: PredictionContext | null,
): context is PredictionContext & { sourceRunId: RunId } {
  return (
    context !== null &&
    context.enabled &&
    context.available &&
    context.idle &&
    context.draftEmpty &&
    context.providerThreadId !== null &&
    context.sourceRunId !== null
  );
}

function sameSource(a: PredictionContext, b: PredictionContext): boolean {
  return (
    a.environmentId === b.environmentId &&
    a.threadId === b.threadId &&
    a.providerInstanceId === b.providerInstanceId &&
    a.providerThreadId === b.providerThreadId &&
    a.sourceRunId === b.sourceRunId
  );
}

interface PredictionTicket {
  readonly context: PredictionContext;
  readonly requestId: string;
}

interface PredictionPorts {
  readonly read: () => PredictionContext | null;
  readonly requestId: () => string;
  readonly request: (target: {
    environmentId: EnvironmentId;
    input: ComposerPredictionInput;
  }) => Promise<ComposerPredictionResult | null>;
  readonly cancel: (target: {
    environmentId: EnvironmentId;
    input: typeof ComposerPredictionCancelInput.Type;
  }) => Promise<void>;
}

export class ComposerPredictionController {
  private view: PredictionView = IDLE;
  private ticket: PredictionTicket | null = null;
  private previous: PredictionContext | null = null;
  private attempted: PredictionContext | null = null;
  private readContext: () => PredictionContext | null;
  private readonly listeners = new Set<() => void>();

  private readonly ports: PredictionPorts;

  constructor(ports: PredictionPorts) {
    this.ports = ports;
    this.readContext = ports.read;
  }

  setContextReader(read: () => PredictionContext | null) {
    this.readContext = read;
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  readonly getSnapshot = () => this.view;

  private publish(view: PredictionView) {
    if (this.view === view) return;
    this.view = view;
    for (const listener of this.listeners) listener();
  }

  private matches(ticket: PredictionTicket): boolean {
    const context = this.readContext();
    return (
      this.ticket === ticket &&
      eligible(context) &&
      sameSource(context, ticket.context) &&
      context.connectionGeneration === ticket.context.connectionGeneration &&
      context.draftRevision === ticket.context.draftRevision
    );
  }

  readonly dismiss = () => {
    const ticket = this.ticket;
    this.ticket = null;
    this.publish(IDLE);
    if (ticket) {
      void this.ports.cancel({
        environmentId: ticket.context.environmentId,
        input: { threadId: ticket.context.threadId, requestId: ticket.requestId },
      });
    }
  };

  readonly accept = (): string | null => {
    const ticket = this.ticket;
    const text =
      ticket && this.matches(ticket) && this.view.status === "suggestion" ? this.view.text : null;
    this.dismiss();
    return text;
  };

  readonly update = () => {
    const context = this.readContext();
    const previous = this.previous;
    this.previous = context;
    if (this.ticket && !this.matches(this.ticket)) this.dismiss();
    if (
      !eligible(context) ||
      this.ticket ||
      (this.attempted && sameSource(context, this.attempted))
    )
      return;
    this.attempted = context;
    const trigger =
      previous && sameSource(previous, context) && previous.sourceActive && !context.sourceActive
        ? "live"
        : "catch_up";
    const ticket = { context, requestId: this.ports.requestId() };
    this.ticket = ticket;
    this.publish({ status: "pending", text: null });
    void this.ports
      .request({
        environmentId: context.environmentId,
        input: {
          threadId: context.threadId,
          sourceRunId: context.sourceRunId,
          requestId: ticket.requestId,
          trigger,
        },
      })
      .then((result) => {
        if (!this.matches(ticket)) {
          if (this.ticket === ticket) this.dismiss();
          return;
        }
        if (
          result?.requestId === ticket.requestId &&
          result.sourceRunId === context.sourceRunId &&
          result.status === "suggestion" &&
          result.text?.trim()
        ) {
          this.publish({ status: "suggestion", text: result.text });
        } else {
          this.ticket = null;
          this.publish(IDLE);
        }
      });
  };
}
