import "~/index.css";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useLocation,
} from "@tanstack/react-router";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { changeLanguage } from "../../i18n";
import { SidebarProvider } from "../ui/sidebar";
import { SettingsSidebarNav } from "./SettingsSidebarNav";
import { retainSettingsScope, validateSettingsRouteSearch } from "./settingsScopeNavigation";

vi.mock("./useAvailableSettingsSearchItems", () => ({
  useAvailableSettingsSearchItems: () => [],
}));
vi.mock("../clerk/T3ConnectSidebarSignIn", () => ({
  T3ConnectSidebarSignIn: () => null,
  T3ConnectSidebarAvatar: () => null,
}));

function SettingsLayout() {
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <SidebarProvider>
      <SettingsSidebarNav pathname={pathname} />
      <Outlet />
    </SidebarProvider>
  );
}

it.each(["en", "zh"] as const)(
  "opens Convene from the ordinary menu in %s and retains the selected machine on return",
  async (language) => {
    await changeLanguage(language);
    await using _language = new AsyncDisposableStack();
    _language.defer(() => changeLanguage("en").then(() => {}));
    const root = createRootRoute({ component: SettingsLayout });
    const settings = createRoute({
      getParentRoute: () => root,
      path: "settings",
      validateSearch: validateSettingsRouteSearch,
      search: { middlewares: [retainSettingsScope] },
    });
    const general = createRoute({
      getParentRoute: () => settings,
      path: "general",
      component: () => <h1>General destination</h1>,
    });
    const convene = createRoute({
      getParentRoute: () => settings,
      path: "convene",
      component: () => <h1>Convene destination</h1>,
    });
    const router = createRouter({
      routeTree: root.addChildren([settings.addChildren([general, convene])]),
      history: createMemoryHistory({
        initialEntries: ["/settings/general?machine=remote-server#old-setting"],
      }),
    });
    await router.load();
    // This route tree exercises the real settings scope middleware.
    await using screen = await render(<RouterProvider router={router} />, { router: false });
    const connections = screen.getByRole("group", { name: "Connections", exact: true });
    await connections.getByRole("button", { name: "Convene", exact: true }).click();
    await expect
      .element(screen.getByRole("heading", { name: "Convene destination" }))
      .toBeVisible();
    expect(router.state.location.pathname).toBe("/settings/convene");
    expect(router.state.location.search).toEqual({ machine: "remote-server" });
    expect(router.state.location.hash).toBe("");
    await screen
      .getByRole("button", { name: language === "en" ? "General" : "通用", exact: true })
      .click();
    await expect
      .element(screen.getByRole("heading", { name: "General destination" }))
      .toBeVisible();
    expect(router.state.location.search).toEqual({ machine: "remote-server" });
  },
);
