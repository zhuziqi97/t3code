import type { TFunction } from "i18next";
import type { ElementType } from "react";
import type { SourceControlProviderInfo } from "@t3tools/contracts";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import type {
  ChangeRequestTerminology,
  SourceControlClientDefinition,
} from "@t3tools/client-runtime/source-control-clients";
import {
  AzureDevOpsIcon,
  BitbucketIcon,
  ForgejoIcon,
  GitCafeIcon,
  GitHubIcon,
  GitLabIcon,
} from "./components/Icons";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";

export type { ChangeRequestTerminology } from "@t3tools/client-runtime/source-control-clients";

type SourceControlIcon = ElementType<{ className?: string }>;

const SOURCE_CONTROL_ICONS: Partial<Record<string, SourceControlIcon>> = {
  github: GitHubIcon,
  gitlab: GitLabIcon,
  forgejo: ForgejoIcon,
  bitbucket: BitbucketIcon,
  "azure-devops": AzureDevOpsIcon,
  gitcafe: GitCafeIcon,
};

export function sourceControlIcon(definition: SourceControlClientDefinition): SourceControlIcon {
  return SOURCE_CONTROL_ICONS[definition.icon] ?? PullRequestGlyph.pullRequest;
}

export interface SourceControlPresentation {
  readonly definition: SourceControlClientDefinition;
  readonly providerName: string;
  readonly terminology: ChangeRequestTerminology;
  readonly Icon: SourceControlIcon;
}

function presentDefinition(
  definition: SourceControlClientDefinition,
  providerName: string,
): SourceControlPresentation {
  return {
    definition,
    providerName,
    terminology: definition.changeRequest,
    Icon: sourceControlIcon(definition),
  };
}

export function getSourceControlPresentation(
  provider: SourceControlProviderInfo | null | undefined,
  t?: TFunction,
): SourceControlPresentation {
  const definition = sourceControlClients.get(provider?.kind);
  const result = presentDefinition(definition, provider?.name || definition.label);
  if (!t) return result;
  return {
    ...result,
    terminology: {
      ...result.terminology,
      singular: t(
        result.terminology.singular === "merge request"
          ? "git.mergeRequest"
          : result.terminology.singular === "change request"
            ? "git.changeRequest"
            : "git.pullRequest",
      ),
    },
  };
}

export function getSourceControlPresentationForKind(kind: string): SourceControlPresentation {
  const definition = sourceControlClients.get(kind);
  return presentDefinition(definition, definition.label);
}
