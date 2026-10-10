import type { TFunction } from "i18next";

/** Labels for the viewer's own chrome; file contents and match state stay with Pierre. */
export function diffViewerLabels(t: TFunction) {
  return {
    unmodifiedLines: (count: number) => t("diff.context.unchangedLines", { count }),
    moreContext: t("diff.context.more"),
    expandAll: t("diff.context.expandAll"),
    expandUp: t("diff.context.expandUp"),
    expandDown: t("diff.context.expandDown"),
    expandBoth: t("diff.context.expandBoth"),
    search: t("diff.find.search"),
    replace: t("diff.find.replace"),
    replaceAll: t("diff.find.replaceAll"),
    matchCase: t("project.search.matchCase"),
    wholeWord: t("project.search.wholeWord"),
    regex: t("project.search.regex"),
    previous: t("diff.find.previous"),
    next: t("diff.find.next"),
    close: t("diff.find.close"),
    noResults: t("diff.find.noResults"),
    results: (count: number) => t("diff.find.results", { count }),
    currentResult: (current: number, count: number) => t("diff.find.current", { current, count }),
  };
}
