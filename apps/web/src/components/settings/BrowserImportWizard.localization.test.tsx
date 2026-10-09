// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { BrowserImportSource } from "@t3tools/contracts";
import { changeLanguage } from "../../i18n";
import { BrowserImportWizard } from "./BrowserImportWizard";
import type { ImportOutcome } from "./browserImportWizard.logic";

const source: BrowserImportSource = {
  id: "helium",
  name: "Helium",
  profiles: [
    { directory: "Default", name: "Source Default", cookieCount: 1 },
    { directory: "Profile 1", name: "Source Work", cookieCount: 5065 },
  ],
};
let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof BrowserImportWizard>;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  await changeLanguage("en");
  props = {
    source,
    destinationEnvironmentName: "Raw Host",
    targetProfiles: [{ id: "profile-work", name: "Raw Work" }],
    canCreateProfile: true,
    onImport: vi.fn(),
    onRefreshSource: vi.fn().mockResolvedValue(source),
    onOpenFullDiskAccessSettings: vi.fn(),
    onCheckFullDiskAccess: vi.fn().mockResolvedValue(false),
    onClose: vi.fn(),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const render = async () => act(async () => root.render(<BrowserImportWizard {...props} />));
const language = async (lang: "en" | "zh") => act(async () => changeLanguage(lang));
function button(label: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === label || node.getAttribute("aria-label") === label,
  );
  expect(found, label).toBeDefined();
  return found!;
}
const click = async (label: string) => act(async () => button(label).click());

it("retains source and target selections, imports native values once, and translates full result quantities", async () => {
  let resolve!: (result: ImportOutcome) => void;
  vi.mocked(props.onImport).mockImplementation(() => new Promise((done) => (resolve = done)));
  await render();
  await click("Source Work5,065 cookies");
  await click("Raw WorkExisting profile");
  await language("zh");
  expect(button("Source Work5,065 个 Cookie").getAttribute("aria-pressed")).toBe("true");
  expect(button("Raw Work已有配置").getAttribute("aria-pressed")).toBe("true");
  expect(props.onImport).not.toHaveBeenCalled();
  await click("导入");
  await language("en");
  expect(props.onImport).toHaveBeenCalledExactlyOnceWith({
    sourceProfileDirectory: "Profile 1",
    target: { kind: "existing", profileId: "profile-work", name: "Raw Work" },
  });
  expect(document.body.textContent).toContain("Importing cookies");
  await language("zh");
  await act(async () =>
    resolve({
      kind: "imported",
      imported: 5065,
      skipped: 4,
      skippedDomains: ["a.test", "b.test", "c.test", "d.test"],
      targetName: "Raw Work",
    }),
  );
  expect(document.body.textContent).toContain("已导入 5,065 个 Cookie");
  expect(document.body.textContent).toContain(
    "已添加到 Raw Host 的 Raw Work 配置，跳过 4 个 Cookie。",
  );
  expect(document.body.textContent).toContain("a.test, b.test, c.test 及另外 1 个域名");
  expect(props.onImport).toHaveBeenCalledTimes(1);
  await click("完成");
  expect(props.onClose).toHaveBeenCalled();
});

it("translates a blocked reason on render and reuses the same new profile id on retry", async () => {
  vi.mocked(props.onImport).mockResolvedValue({ kind: "blocked", reason: "readFailed" });
  await render();
  await click("Import");
  const first = vi.mocked(props.onImport).mock.calls[0]![0];
  await language("zh");
  expect(document.body.textContent).toContain("无法读取该浏览器的 Cookie 数据库。");
  expect(props.onImport).toHaveBeenCalledTimes(1);
  await click("重试");
  expect(vi.mocked(props.onImport).mock.calls[1]![0]).toEqual(first);
  await language("en");
  expect(document.body.textContent).toContain("The browser's cookie database could not be read.");
});

it("keeps one browser recheck pending while its checking page changes language", async () => {
  props = { ...props, source: { ...source, unavailable: "browserRunning" } };
  let resolve!: (result: BrowserImportSource) => void;
  vi.mocked(props.onRefreshSource).mockImplementation(
    () => new Promise((done) => (resolve = done)),
  );
  await render();
  await language("zh");
  expect(document.body.textContent).toContain("退出 Helium 后导入");
  expect(props.onRefreshSource).not.toHaveBeenCalled();
  await click("我已退出");
  await language("en");
  expect(document.body.textContent).toContain("Checking Helium");
  expect(props.onRefreshSource).toHaveBeenCalledTimes(1);
  await act(async () => resolve(source));
  expect(document.body.textContent).toContain("Import from Helium");
  expect(props.onImport).not.toHaveBeenCalled();
});

it("retranslates permission failures without restarting polling and unlocks only after a successful check", async () => {
  props = { ...props, source: { ...source, unavailable: "needsFullDiskAccess" } };
  vi.mocked(props.onCheckFullDiskAccess!).mockRejectedValueOnce(
    new Error("raw permission failure"),
  );
  vi.mocked(props.onOpenFullDiskAccessSettings).mockRejectedValue(
    new Error("raw settings failure"),
  );
  await render();
  expect(document.body.textContent).toContain(
    "Could not check permissions. We'll try again automatically.",
  );
  expect(button("Continue").disabled).toBe(true);
  await language("zh");
  expect(document.body.textContent).toContain("无法检查权限，将自动重试。");
  expect(props.onCheckFullDiskAccess).toHaveBeenCalledTimes(1);
  await click("允许");
  expect(document.body.textContent).toContain("无法打开系统设置，请再次点击“允许”。");
  await language("en");
  expect(document.body.textContent).toContain("Could not open System Settings. Try Allow again.");
  expect(props.onOpenFullDiskAccessSettings).toHaveBeenCalledTimes(1);
  vi.mocked(props.onCheckFullDiskAccess!).mockResolvedValue(true);
  await act(async () => vi.advanceTimersByTimeAsync(1500));
  expect(props.onCheckFullDiskAccess).toHaveBeenCalledTimes(2);
  expect(button("Continue").disabled).toBe(false);
  expect(document.body.textContent).toContain("Allowed");
});

it("retains a disappeared target selection and reports the problem without starting an import", async () => {
  await render();
  await click("Raw WorkExisting profile");
  props = { ...props, targetProfiles: [] };
  await render();
  await language("zh");
  expect(document.body.textContent).toContain("此配置已不可用，请重新选择 Cookie 的导入目标。");
  expect(button("导入").disabled).toBe(true);
  expect(props.onImport).not.toHaveBeenCalled();
});

it("translates the built-in target label while importing under its original id and name", async () => {
  props = {
    ...props,
    canCreateProfile: false,
    targetProfiles: [{ id: "default", name: "Default" }],
  };
  vi.mocked(props.onImport).mockResolvedValue({
    kind: "imported",
    imported: 1,
    skipped: 0,
    skippedDomains: [],
    targetName: "Default",
  });
  await render();
  await language("zh");
  expect(button("默认已有配置").getAttribute("aria-pressed")).toBe("true");
  await click("导入");
  expect(props.onImport).toHaveBeenCalledExactlyOnceWith({
    sourceProfileDirectory: "Default",
    target: { kind: "existing", profileId: "default", name: "Default" },
  });
  expect(document.body.textContent).toContain("已添加到 Raw Host 的 默认 配置。");
  await language("en");
  expect(document.body.textContent).toContain("Added to Default for Raw Host.");
  expect(props.onImport).toHaveBeenCalledTimes(1);
});
