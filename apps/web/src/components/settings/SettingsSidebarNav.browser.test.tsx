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

import { act, render } from "../../../test/render";
import { changeLanguage } from "../../i18n";
import { SidebarProvider } from "../ui/sidebar";
import { SettingsSidebarNav } from "./SettingsSidebarNav";
import { SETTINGS_SEARCH_ITEMS } from "./settingsSearch";
import { retainSettingsScope, validateSettingsRouteSearch } from "./settingsScopeNavigation";

vi.mock("./useAvailableSettingsSearchItems", () => ({
  useAvailableSettingsSearchItems: () => SETTINGS_SEARCH_ITEMS,
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
        initialEntries: [
          `/settings/general?${language === "en" ? "machine" : "environmentId"}=remote-server#old-setting`,
        ],
      }),
    });
    await router.load();
    // This route tree exercises the real settings scope middleware.
    await using screen = await render(<RouterProvider router={router} />, { router: false });
    const connections = screen.getByRole("group", {
      name: language === "en" ? "Connections" : "连接",
      exact: true,
    });
    const menu = connections.getByRole("treeitem", { name: "Convene", exact: true });
    const menuElement = menu.element();
    await menu.click();
    await expect
      .element(screen.getByRole("heading", { name: "Convene destination" }))
      .toBeVisible();
    expect(router.state.location.pathname).toBe("/settings/convene");
    expect(router.state.location.search).toEqual({ machine: "remote-server" });
    expect(router.state.location.hash).toBe("");
    const nextLanguage = language === "en" ? "zh" : "en";
    await act(async () => changeLanguage(nextLanguage));
    expect(screen.getByRole("treeitem", { name: "Convene", exact: true }).element()).toBe(
      menuElement,
    );
    expect(router.state.location.search).toEqual({ machine: "remote-server" });
    await screen
      .getByRole("treeitem", { name: nextLanguage === "en" ? "General" : "通用", exact: true })
      .click();
    await expect
      .element(screen.getByRole("heading", { name: "General destination" }))
      .toBeVisible();
    expect(router.state.location.search).toEqual({ machine: "remote-server" });
    await screen.getByRole("button", { name: "Search settings", exact: true }).click();
    const search = screen.getByRole("combobox");
    await expect.element(search).toBeVisible();
    const searchElement = search.element();
    await search.fill("Convene");
    await act(async () => changeLanguage(language));
    expect(screen.getByRole("combobox").element()).toBe(searchElement);
    await expect.element(search).toHaveValue("Convene");
    const result = screen.getByRole("option", {
      name: language === "en" ? /Connect Convene/ : /连接 Convene/,
    });
    await expect
      .element(result)
      .toHaveTextContent(language === "en" ? "Connect Convene" : "连接 Convene");
    await result.click();
    await expect
      .element(screen.getByRole("heading", { name: "Convene destination" }))
      .toBeVisible();
    expect(router.state.location.pathname).toBe("/settings/convene");
    expect(router.state.location.search).toEqual({ machine: "remote-server" });
    expect(router.state.location.hash).toBe("convene-connection");
    await screen
      .getByRole("treeitem", { name: language === "en" ? "General" : "通用", exact: true })
      .click();
    await expect
      .element(screen.getByRole("heading", { name: "General destination" }))
      .toBeVisible();
    expect(router.state.location.search).toEqual({ machine: "remote-server" });
    expect(router.state.location.hash).toBe("");
  },
);
