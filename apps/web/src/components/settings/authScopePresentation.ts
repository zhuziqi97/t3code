import type { TFunction } from "i18next";
import { AUTH_SCOPE_OPTIONS } from "@t3tools/shared/authScopeOptions";

export function authScopePresentation(option: (typeof AUTH_SCOPE_OPTIONS)[number], t: TFunction) {
  const key = `permissions.scope.${option.scope.replaceAll(":", "-")}`;
  return {
    ...option,
    title: t(`${key}.title`, { defaultValue: option.title }),
    description: t(`${key}.description`, { defaultValue: option.description }),
  };
}
