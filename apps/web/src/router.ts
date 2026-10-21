import { createRouter, RouterHistory } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";
import { webBasePath } from "./webBasePath";

export function getRouter(history: RouterHistory) {
  return createRouter({
    routeTree,
    history,
    basepath: webBasePath() || "/",
    context: {},
    defaultPreload: "intent",
  });
}

export type AppRouter = ReturnType<typeof getRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
