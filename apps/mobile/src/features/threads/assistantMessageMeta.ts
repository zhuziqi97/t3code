import { runEndState } from "@t3tools/client-runtime/runEndState";
import type { RunId } from "@t3tools/contracts";
import type { ThreadFeedLatestRun, ThreadFeedMessage } from "../../lib/threadActivity";

export function mobileRunEndFeedback(input: {
  readonly latestRun: ThreadFeedLatestRun | null;
  readonly completionHeld: boolean;
  readonly runlessWorkActive: boolean;
  readonly activeWorkStartedAt: string | null;
}) {
  return !input.completionHeld && !input.runlessWorkActive && input.activeWorkStartedAt === null
    ? runEndState(input.latestRun)
    : null;
}

export function assistantMessageShowsMeta(input: {
  readonly message: Pick<ThreadFeedMessage, "role" | "runId" | "streaming" | "attachments">;
  readonly terminal: boolean;
  readonly unsettledTurnId: RunId | null;
  readonly renderedText: string;
}): boolean {
  const { message } = input;
  return (
    message.role === "assistant" &&
    input.terminal &&
    !message.streaming &&
    !(message.runId !== null && message.runId === input.unsettledTurnId) &&
    (input.renderedText.trim().length > 0 || message.attachments.length > 0)
  );
}
