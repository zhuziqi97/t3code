import type { ProjectCloneSnapshot } from "@t3tools/contracts";
import type { TFunction } from "i18next";
import { i18n } from "../i18n";

export function localizedProjectCloneProgressSummary(
  snapshot: Pick<ProjectCloneSnapshot, "stage" | "percent" | "detail">,
  t: TFunction = i18n.t,
): string {
  const parts = [t(`project.clone.stage.${snapshot.stage}`)];
  if (snapshot.percent !== null) parts.push(`${snapshot.percent}%`);
  if (snapshot.detail) parts.push(snapshot.detail);
  return parts.join(" · ");
}
