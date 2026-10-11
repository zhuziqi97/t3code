import { afterEach, expect, it, vi } from "vite-plus/test";
import { createI18n } from "@t3tools/client-runtime/i18n";
import { searchOpenVsxThemes } from "../../openVsxThemes";
import {
  installCustomTheme,
  invalidateCustomThemes,
  parseThemeFile,
  THEME_FILE_VERSION,
} from "../../themePalette";
import { parseVsCodeThemeFile } from "../../vscodeThemeImport";
import { describeOversizedThemeFile } from "./ThemeImportDialog";
import { translateThemeError } from "./themeErrorMessages";

function failure(run: () => unknown): string {
  try {
    run();
  } catch (cause) {
    if (cause instanceof Error) return cause.message;
    throw cause;
  }
  return expect.fail("Expected the actual theme operation to fail");
}
const translate = createI18n({ lng: "zh" }).t;
const input = {
  version: THEME_FILE_VERSION,
  id: "raw-theme",
  name: "Raw Theme Name",
  appearance: "dark",
  colors: { canvas: "#111111" },
};
afterEach(() => {
  vi.unstubAllGlobals();
  invalidateCustomThemes();
});

it("translates actual parser failures while retaining native JSON values and color roles", () => {
  expect(
    translateThemeError(
      failure(() => parseThemeFile({ ...input, version: -1 })),
      translate,
    ),
  ).toBe(`该主题文件的版本不受支持。需要版本 ${THEME_FILE_VERSION}。`);
  expect(
    translateThemeError(
      failure(() => parseThemeFile({ ...input, colors: { RawRole: "#ffffff" } })),
      translate,
    ),
  ).toBe('"RawRole" 不是受支持的主题颜色字段。');
  expect(
    translateThemeError(
      failure(() => parseThemeFile({ ...input, appearance: "system" })),
      translate,
    ),
  ).toBe('主题文件的 appearance 字段必须为 "light" 或 "dark"。');
  expect(
    translateThemeError(
      failure(() => parseVsCodeThemeFile({ colors: {} })),
      translate,
    ),
  ).toBe('该 VS Code 主题没有 "editor.background" 颜色，无法据此生成配色。');
});

it("translates actual storage failures and retains the storage key", () => {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: () => null,
      setItem: () => {
        throw new Error("Raw quota diagnostic");
      },
    },
  });
  invalidateCustomThemes();
  const message = failure(() => installCustomTheme(parseThemeFile(input)));
  const key = /^Failed to write the theme library to (.+)\.$/.exec(message)![1]!;
  expect(translateThemeError(message, translate)).toBe(`无法将主题库写入 ${key}。`);
});

it("translates an actual unavailable Open VSX response and preserves unknown network diagnostics", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 503 })),
  );
  try {
    await searchOpenVsxThemes("Raw Query");
    expect.fail("Expected an unavailable response to fail");
  } catch (cause) {
    expect(cause).toBeInstanceOf(Error);
    expect(translateThemeError((cause as Error).message, translate)).toBe(
      "Open VSX 搜索暂时不可用。",
    );
  }
  const raw = "Raw gateway failure: ECONNRESET /theme.json";
  expect(translateThemeError(raw, translate)).toBe(raw);
});

it("translates the size guard without changing its measured size or limit", () => {
  const message = describeOversizedThemeFile(100 * 1024 * 1024)!;
  expect(translateThemeError(message, translate)).toBe(
    "该文件大小为 100.0 MB。主题文件通常只有几 KB，因此未读取此文件（上限为 256 KB）。",
  );
});
