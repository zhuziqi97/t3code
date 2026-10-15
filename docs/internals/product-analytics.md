# Product analytics

Convene distributions disable upstream product analytics unconditionally. The existing
AnalyticsService interface is retained so upstream orchestration call sites can merge without
changes, but both recording and flushing are no-ops. No provider account ID is read, no
installation identifier is created, and no PostHog batch is sent. Environment overrides do
not enable this feature.

When merging upstream, preserve this distribution decision together with the removal of the
usage-collection banner and upstream privacy entry from the shipped web/desktop settings.
Local diagnostics and configured agent/provider traffic have their own responsibilities.
