import type { TFunction } from "i18next";
import type { ElementType } from "react";
import type { SourceControlProviderInfo, SourceControlProviderKind } from "@t3tools/contracts";
export {
  DEFAULT_CHANGE_REQUEST_TERMINOLOGY,
  getChangeRequestTerminology,
  resolveChangeRequestPresentation,
  type ChangeRequestPresentation,
  type ChangeRequestTerminology,
} from "@t3tools/shared/sourceControl";
import {
  getChangeRequestTerminology,
  resolveChangeRequestPresentation,
  type ChangeRequestTerminology,
} from "@t3tools/shared/sourceControl";
import {
  AzureDevOpsIcon,
  BitbucketIcon,
  ForgejoIcon,
  GitHubIcon,
  GitLabIcon,
} from "./components/Icons";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";

export interface SourceControlPresentation {
  readonly providerName: string;
  readonly terminology: ChangeRequestTerminology;
  readonly Icon: ElementType<{ className?: string }>;
}

export function getSourceControlPresentation(
  provider: SourceControlProviderInfo | null | undefined,
  t?: TFunction,
): SourceControlPresentation {
  const presentation = resolveChangeRequestPresentation(provider);
  const rawTerminology = getChangeRequestTerminology(provider);
  const terminology = t
    ? {
        ...rawTerminology,
        singular: t(
          rawTerminology.singular === "merge request"
            ? "git.mergeRequest"
            : rawTerminology.singular === "change request"
              ? "git.changeRequest"
              : "git.pullRequest",
        ),
      }
    : rawTerminology;
  switch (presentation.icon) {
    case "github":
      return {
        providerName: provider?.name || presentation.providerName,
        terminology,
        Icon: GitHubIcon,
      };
    case "forgejo":
      return {
        providerName: provider?.name || presentation.providerName,
        terminology,
        Icon: ForgejoIcon,
      };
    case "gitlab":
      return {
        providerName: provider?.name || presentation.providerName,
        terminology,
        Icon: GitLabIcon,
      };
    case "azure-devops":
      return {
        providerName: provider?.name || presentation.providerName,
        terminology,
        Icon: AzureDevOpsIcon,
      };
    case "bitbucket":
      return {
        providerName: provider?.name || presentation.providerName,
        terminology,
        Icon: BitbucketIcon,
      };
    case "change-request":
      return {
        providerName: provider?.name || presentation.providerName,
        terminology,
        Icon: PullRequestGlyph.pullRequest,
      };
  }
}

/** For surfaces that know only the host kind, such as a change request row or filter. */
export function getSourceControlPresentationForKind(
  kind: SourceControlProviderKind,
): SourceControlPresentation {
  return getSourceControlPresentation({ kind, name: "", baseUrl: "" });
}
