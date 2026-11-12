import { i18n, type DiffsMessages } from "@pierre/diffs";
import type { TFunction } from "i18next";
import { useLayoutEffect } from "react";
import { useResolvedLanguage, useTranslate } from "../../i18n";

function diffViewerLabels(t: TFunction): Partial<DiffsMessages> {
  return {
    unmodifiedLines: t("diff.context.unchangedLinesMessage"),
    unknownUnmodifiedLines: t("diff.context.more"),
    expandAll: t("diff.context.expandAll"),
    expandUp: t("diff.context.expandUp"),
    expandDown: t("diff.context.expandDown"),
    expandBoth: t("diff.context.expandBoth"),
    searchPlaceholder: t("diff.find.search"),
    replacePlaceholder: t("diff.find.replace"),
    replaceMatch: t("diff.find.replace"),
    replaceAllMatches: t("diff.find.replaceAll"),
    matchCase: t("project.search.matchCase"),
    wholeWord: t("project.search.wholeWord"),
    regularExpression: t("project.search.regex"),
    previousMatch: t("diff.find.previous"),
    nextMatch: t("diff.find.next"),
    closeSearch: t("diff.find.close"),
    noSearchResults: t("diff.find.noResults"),
    searchResultCount: t("diff.find.resultsMessage"),
    searchResultPosition: t("diff.find.currentMessage"),
  };
}

export function useDiffViewerI18n() {
  const t = useTranslate();
  const locale = useResolvedLanguage();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- synchronizes Pierre's native message singleton with the selected UI language
  useLayoutEffect(() => {
    i18n.set({ locale: locale ?? "en", messages: diffViewerLabels(t) });
  }, [locale, t]);
}
