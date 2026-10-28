import type { MessageKey } from "@t3tools/client-runtime/i18n";
import type { TFunction } from "i18next";
import { en } from "./i18n/messages.en.ts";
import type { PullRequestReaction, PullRequestReactionContent } from "@t3tools/contracts";

export const PULL_REQUEST_REACTION_ORDER: ReadonlyArray<PullRequestReactionContent> = [
  "thumbs-up",
  "thumbs-down",
  "laugh",
  "hooray",
  "confused",
  "heart",
  "rocket",
  "eyes",
];

const REACTION_EMOJI: Record<PullRequestReactionContent, string> = {
  "thumbs-up": "👍",
  "thumbs-down": "👎",
  laugh: "😄",
  hooray: "🎉",
  confused: "😕",
  heart: "❤️",
  rocket: "🚀",
  eyes: "👀",
};

/** The spoken names GitHub uses in its own hover text, which is what a screen reader reads out. */
const REACTION_NAME: Record<PullRequestReactionContent, MessageKey> = {
  "thumbs-up": "pullRequest.flow.reaction.thumbsUp",
  "thumbs-down": "pullRequest.flow.reaction.thumbsDown",
  laugh: "pullRequest.flow.reaction.laugh",
  hooray: "pullRequest.flow.reaction.hooray",
  confused: "pullRequest.flow.reaction.confused",
  heart: "pullRequest.flow.reaction.heart",
  rocket: "pullRequest.flow.reaction.rocket",
  eyes: "pullRequest.flow.reaction.eyes",
};

export function pullRequestReactionEmoji(content: PullRequestReactionContent): string {
  return REACTION_EMOJI[content];
}

export function pullRequestReactionName(
  content: PullRequestReactionContent,
  t?: TFunction,
): string {
  return t ? t(REACTION_NAME[content]) : en[REACTION_NAME[content]];
}

const NAMED_ACTOR_LIMIT = 3;

function joinNames(parts: ReadonlyArray<string>, language = "en"): string {
  return new Intl.ListFormat(language, { type: "conjunction" }).format(parts);
}

/** "others" only alongside somebody named; on its own a count is people, not other people. */
function countRemainder(count: number, named: boolean, t?: TFunction): string {
  if (!t) return `${count} ${named ? "others" : "people"}`;
  return t(named ? "pullRequest.flow.reaction.others" : "pullRequest.flow.reaction.people", {
    count,
  });
}

/** Hosts omit the viewer from actors; add You only if count has room, since viewer login is unavailable. */
export function pullRequestReactionTooltip(
  reaction: PullRequestReaction,
  t?: TFunction,
  language?: string,
): string {
  const viewerHasRoom = reaction.actors.length < reaction.count;
  const names =
    reaction.viewerHasReacted && viewerHasRoom
      ? [t ? t("pullRequest.flow.reaction.you") : "You", ...reaction.actors]
      : [...reaction.actors];
  const shown = names.slice(0, Math.min(NAMED_ACTOR_LIMIT, reaction.count));
  const others = Math.max(0, reaction.count - shown.length);
  const parts = [...shown, ...(others > 0 ? [countRemainder(others, shown.length > 0, t)] : [])];
  if (!t)
    return `${joinNames(parts, language)} reacted with ${pullRequestReactionName(reaction.content)}`;
  return t("pullRequest.flow.reaction.tooltip", {
    names: joinNames(parts, language),
    reaction: pullRequestReactionName(reaction.content, t),
  });
}

/** Changes whenever the host reports different reactions, so pending overlays can reset. */
export function pullRequestReactionsSignature(
  reactions: ReadonlyArray<PullRequestReaction>,
): string {
  return reactions
    .map((reaction) => `${reaction.content}:${reaction.count}:${reaction.viewerHasReacted ? 1 : 0}`)
    .join(" ");
}

export function applyPendingPullRequestReactions(
  reactions: ReadonlyArray<PullRequestReaction>,
  pending: ReadonlyMap<PullRequestReactionContent, boolean>,
): ReadonlyArray<PullRequestReaction> {
  if (pending.size === 0) return reactions;
  const byContent = new Map(reactions.map((reaction) => [reaction.content, reaction] as const));
  for (const [content, reacted] of pending) {
    const current = byContent.get(content);
    if (current === undefined) {
      if (reacted) {
        byContent.set(content, { content, count: 1, actors: [], viewerHasReacted: true });
      }
      continue;
    }
    if (current.viewerHasReacted === reacted) continue;
    const count = current.count + (reacted ? 1 : -1);
    if (count <= 0) byContent.delete(content);
    else byContent.set(content, { ...current, count, viewerHasReacted: reacted });
  }
  return PULL_REQUEST_REACTION_ORDER.flatMap((content) => byContent.get(content) ?? []);
}
