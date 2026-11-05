import type { CodexNativePredictionMode } from "@t3tools/contracts/settings";
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
  readonly mode: CodexNativePredictionMode;
  readonly available: boolean;
  readonly idle: boolean;
  readonly sourceActive: boolean;
  readonly draftRevision: number;
  readonly draftEmpty: boolean;
}

export function threadPredictionContext(
  thread: EnvironmentThreadShell | null,
  options: {
    readonly mode: CodexNativePredictionMode;
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
    mode: options.mode,
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

export type PredictionView =
  | {
      readonly status:
        | "idle"
        | "pending"
        | "off"
        | Exclude<ComposerPredictionResult["status"], "suggestion">;
      readonly text: null;
    }
  | { readonly status: "suggestion"; readonly text: string };
const IDLE: PredictionView = { status: "idle", text: null };

export function predictionAcceptsTab(input: {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly isComposing: boolean;
  readonly keyCode: number;
  readonly defaultPrevented: boolean;
  readonly focused: boolean;
  readonly menuActive: boolean;
  readonly editorEmpty: boolean;
}): boolean {
  return (
    input.key === "Tab" &&
    !input.shiftKey &&
    !input.altKey &&
    !input.ctrlKey &&
    !input.metaKey &&
    !input.isComposing &&
    input.keyCode !== 229 &&
    !input.defaultPrevented &&
    input.focused &&
    !input.menuActive &&
    input.editorEmpty
  );
}

export function predictionShortcutAction(input: {
  readonly matched: boolean;
  readonly repeat: boolean;
  readonly isComposing: boolean;
  readonly keyCode: number;
  readonly defaultPrevented: boolean;
  readonly focused: boolean;
  readonly menuActive: boolean;
  readonly editorEmpty: boolean;
}): "pass" | "ignore" | "request" {
  if (
    !input.matched ||
    input.isComposing ||
    input.keyCode === 229 ||
    input.defaultPrevented ||
    !input.focused ||
    input.menuActive ||
    !input.editorEmpty
  )
    return "pass";
  return input.repeat ? "ignore" : "request";
}

function eligible(
  context: PredictionContext | null,
): context is PredictionContext & { sourceRunId: RunId } {
  return (
    context !== null &&
    context.mode !== "off" &&
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
  outcome: PredictionView;
  readonly cancellation?: Promise<void>;
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

  readonly invalidate = () => {
    const ticket = this.ticket;
    this.ticket = null;
    this.publish(IDLE);
    if (ticket?.outcome.status === "pending" && !ticket.cancellation)
      void this.cancel(ticket).catch(() => {});
  };

  private cancel(ticket: PredictionTicket) {
    return this.ports.cancel({
      environmentId: ticket.context.environmentId,
      input: { threadId: ticket.context.threadId, requestId: ticket.requestId },
    });
  }

  readonly dismiss = () => {
    const ticket = this.ticket;
    if (ticket && !this.matches(ticket)) {
      this.invalidate();
      return;
    }
    if (ticket?.outcome.status === "pending") {
      const cancellation = ticket.cancellation ?? this.cancel(ticket);
      void cancellation.catch(() => {});
      this.ticket = { ...ticket, outcome: { status: "cancelled", text: null }, cancellation };
    }
    this.publish(IDLE);
  };

  readonly accept = (): string | null => {
    const ticket = this.ticket;
    if (ticket && !this.matches(ticket)) this.invalidate();
    const text =
      ticket && this.matches(ticket) && this.view.status === "suggestion" ? this.view.text : null;
    if (text !== null) this.invalidate();
    return text;
  };

  readonly requestManual = (): boolean => {
    const context = this.readContext();
    if (context && !context.draftEmpty) return false;
    if (!eligible(context)) {
      this.invalidate();
      this.publish({
        status:
          context?.mode === "off" ? "off" : context && !context.idle ? "not_idle" : "unsupported",
        text: null,
      });
      return true;
    }
    if (this.ticket && !this.matches(this.ticket)) this.invalidate();
    const outcome = this.ticket?.outcome;
    if (
      outcome &&
      outcome.status !== "empty" &&
      outcome.status !== "error" &&
      outcome.status !== "cancelled"
    ) {
      this.publish(outcome);
      return true;
    }
    const cancelled = this.ticket;
    if (cancelled?.cancellation) {
      const cancellation =
        outcome?.status === "error" ? this.cancel(cancelled) : cancelled.cancellation;
      const waiting: PredictionTicket = {
        ...cancelled,
        outcome: { status: "pending", text: null },
        cancellation,
      };
      this.ticket = waiting;
      this.publish(waiting.outcome);
      void cancellation.then(
        () => {
          if (this.matches(waiting)) this.start(context, "manual", "catch_up");
          else if (this.ticket === waiting) this.invalidate();
        },
        () => {
          if (!this.matches(waiting)) {
            if (this.ticket === waiting) this.invalidate();
            return;
          }
          waiting.outcome = { status: "error", text: null };
          this.publish(waiting.outcome);
        },
      );
      return true;
    }
    this.start(context, "manual", "catch_up");
    return true;
  };

  readonly update = () => {
    const context = this.readContext();
    const previous = this.previous;
    this.previous = context;
    if (this.ticket && !this.matches(this.ticket)) this.invalidate();
    if (
      !this.ticket &&
      previous &&
      (!context ||
        !sameSource(context, previous) ||
        context.connectionGeneration !== previous.connectionGeneration ||
        context.draftRevision !== previous.draftRevision ||
        context.mode !== previous.mode ||
        context.draftEmpty !== previous.draftEmpty ||
        context.idle !== previous.idle ||
        context.available !== previous.available)
    )
      this.publish(IDLE);
    if (
      !eligible(context) ||
      context.mode !== "auto" ||
      this.ticket ||
      (this.attempted && sameSource(context, this.attempted))
    )
      return;
    const trigger =
      previous && sameSource(previous, context) && previous.sourceActive && !context.sourceActive
        ? "live"
        : "catch_up";
    this.start(context, "auto", trigger);
  };

  private start(
    context: PredictionContext & { sourceRunId: RunId },
    intent: "auto" | "manual",
    trigger: ComposerPredictionInput["trigger"],
  ) {
    this.attempted = context;
    const ticket: PredictionTicket = {
      context,
      requestId: this.ports.requestId(),
      outcome: { status: "pending", text: null },
    };
    this.ticket = ticket;
    this.publish(ticket.outcome);
    const settle = (result: ComposerPredictionResult | null) => {
      if (!this.matches(ticket)) {
        if (this.ticket === ticket) this.invalidate();
        return;
      }
      if (result?.requestId === ticket.requestId && result.sourceRunId === context.sourceRunId) {
        ticket.outcome =
          result.status === "suggestion" && result.text?.trim()
            ? { status: "suggestion", text: result.text }
            : { status: result.status === "suggestion" ? "empty" : result.status, text: null };
      } else ticket.outcome = { status: "error", text: null };
      this.publish(ticket.outcome);
    };
    void this.ports
      .request({
        environmentId: context.environmentId,
        input: {
          threadId: context.threadId,
          sourceRunId: context.sourceRunId,
          requestId: ticket.requestId,
          trigger,
          intent,
        },
      })
      .then(settle, () => settle(null));
  }
}
