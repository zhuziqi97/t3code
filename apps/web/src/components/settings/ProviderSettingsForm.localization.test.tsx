// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { ProviderDriverKind } from "@t3tools/contracts";

vi.mock("./settingsLayout", () => ({
  SettingsRow: ({
    title,
    description,
    control,
    children,
  }: {
    title: ReactNode;
    description: ReactNode;
    control: ReactNode;
    children: ReactNode;
  }) => (
    <section>
      {title}
      {description}
      {control}
      {children}
    </section>
  ),
}));
import { changeLanguage } from "../../i18n";
import { providerClients } from "./providerDriverMeta";
import { ProviderSettingsForm } from "./ProviderSettingsForm";

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
  vi.unstubAllGlobals();
});
const render = async (node: ReactNode) => act(async () => root.render(node));
const type = async (input: HTMLInputElement, value: string) =>
  act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const pressEnter = async (input: HTMLInputElement) =>
  act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
const click = async (node: HTMLElement) => act(async () => node.click());
const switchLanguage = async (language: "en" | "zh") => act(async () => changeLanguage(language));

it("keeps an uncommitted executable path through language changes and commits the original value", async () => {
  const onChange = vi.fn();
  const definition = providerClients.get(ProviderDriverKind.make("claudeAgent"))!;
  await render(
    <ProviderSettingsForm
      definition={definition}
      value={{ forkOwned: "keep" }}
      idPrefix="controlled"
      variant="card"
      onChange={onChange}
    />,
  );
  await type(
    container.querySelector<HTMLInputElement>("#controlled-binaryPath")!,
    "/raw/path/to/claude",
  );
  expect(onChange).not.toHaveBeenCalled();
  await switchLanguage("zh");
  const input = container.querySelector<HTMLInputElement>("#controlled-binaryPath")!;
  expect(input.value).toBe("/raw/path/to/claude");
  expect(container.textContent).toContain("可执行文件路径");
  expect(onChange).not.toHaveBeenCalled();
  await pressEnter(input);
  expect(onChange).toHaveBeenCalledExactlyOnceWith({
    forkOwned: "keep",
    binaryPath: "/raw/path/to/claude",
  });
});

it("uses translated sign-in choices while persisting their original enum values", async () => {
  const onChange = vi.fn();
  const definition = providerClients.get(ProviderDriverKind.make("antigravity"))!;
  function Form() {
    const [value, setValue] = useState<Record<string, unknown> | undefined>({
      authMethod: "oauth-business",
      apiKey: "controlled-key",
    });
    return (
      <ProviderSettingsForm
        definition={definition}
        value={value}
        idPrefix="controlled"
        variant="dialog"
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }
  await render(<Form />);
  await switchLanguage("zh");
  expect(container.querySelector<HTMLInputElement>("#controlled-apiKey")!.value).toBe(
    "controlled-key",
  );
  expect(onChange).not.toHaveBeenCalled();
  await click(container.querySelector<HTMLButtonElement>("#controlled-authMethod")!);
  const choice = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) =>
    node.textContent?.includes("Gemini API 密钥"),
  );
  expect(choice).toBeDefined();
  await click(choice!);
  expect(onChange).toHaveBeenCalledExactlyOnceWith({
    authMethod: "gemini-api-key",
    apiKey: "controlled-key",
  });
  await switchLanguage("en");
  expect(
    container.querySelector<HTMLButtonElement>("#controlled-authMethod")!.textContent,
  ).toContain("Gemini API key");
  expect(onChange).toHaveBeenCalledTimes(1);
});

it("keeps local ACP argument rows and commits a literal argument after switching languages", async () => {
  const onChange = vi.fn();
  const definition = providerClients.get(ProviderDriverKind.make("acpRegistry"))!;
  await render(
    <ProviderSettingsForm
      definition={definition}
      value={{ source: "local", commandPath: "dsh", commandArgs: [] }}
      idPrefix="controlled"
      variant="settings"
      onChange={onChange}
    />,
  );
  await click(
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.textContent?.trim() === "Add argument",
    )!,
  );
  await type(
    container.querySelector<HTMLInputElement>('input[aria-label="Argument 1"]')!,
    "--literal=value with spaces",
  );
  await switchLanguage("zh");
  const input = container.querySelector<HTMLInputElement>('input[aria-label="参数 1"]')!;
  expect(input.value).toBe("--literal=value with spaces");
  expect(container.textContent).toContain("此执行环境中的可执行文件名称或路径。");
  expect(container.textContent).not.toContain("注册表智能体 ID");
  await pressEnter(input);
  expect(onChange).toHaveBeenLastCalledWith({
    source: "local",
    commandPath: "dsh",
    commandArgs: ["--literal=value with spaces"],
  });
});
