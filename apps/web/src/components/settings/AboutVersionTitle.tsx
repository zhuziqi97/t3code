import {
  APP_VERSION,
  UPSTREAM_VERSION,
  CONVENE_BUILD_ID,
  CONVENE_SOURCE_COMMIT,
} from "../../branding";
import { useTranslate } from "../../i18n";

export function AboutVersionTitle() {
  const t = useTranslate();
  return (
    <span className="inline-flex flex-wrap items-baseline gap-2">
      <span>{t("about.version")}</span>
      <code className="text-2xs font-medium text-muted-foreground">{APP_VERSION}</code>
      <span className="text-2xs text-muted-foreground">
        {t("convene.about.upstream", {
          version: UPSTREAM_VERSION,
          defaultValue: "Upstream base {{version}}",
        })}
      </span>
      {CONVENE_BUILD_ID ? (
        <span className="text-2xs text-muted-foreground">
          {t("convene.about.build", {
            buildId: CONVENE_BUILD_ID,
            defaultValue: "Build {{buildId}}",
          })}
        </span>
      ) : null}
      {CONVENE_SOURCE_COMMIT ? (
        <span className="break-all text-2xs text-muted-foreground">
          {t("convene.about.sourceCommit", {
            commit: CONVENE_SOURCE_COMMIT,
            defaultValue: "Source {{commit}}",
          })}
        </span>
      ) : null}
    </span>
  );
}
