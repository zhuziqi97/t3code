import { expect, it } from "vite-plus/test";
import { snapShotModifierPairLabel } from "@t3tools/contracts";
import { i18n } from "../../i18n";
import { formatSnapShotMessage } from "./snapShotMessages";

it("translates owned desktop guidance and retains native keys, paths and unknown diagnostics", () => {
  const t = i18n.getFixedT("zh");
  expect(
    formatSnapShotMessage("Allow Screen Recording in System Settings, then restart T3 Code.", t),
  ).toBe("请在系统设置中允许“屏幕录制”，然后重启 T3 Code。");
  expect(
    formatSnapShotMessage(
      "Ctrl+Alt+Y is already used in /Raw Dir/config.kdl. Choose another shortcut.",
      t,
    ),
  ).toBe("/Raw Dir/config.kdl 已使用 Ctrl+Alt+Y，请选择其他快捷键。");
  const pair = snapShotModifierPairLabel("control", false);
  expect(formatSnapShotMessage(`${pair} is not available on this system.`, t)).toBe(
    `此系统无法使用 ${pair}。`,
  );
  expect(
    formatSnapShotMessage(
      "The bundled extension supports GNOME 47, 48. This session runs GNOME 49.",
      t,
    ),
  ).toBe("自带扩展支持 GNOME 47, 48，当前会话运行 GNOME 49。");
  expect(formatSnapShotMessage("Raw D-Bus error: permission denied", t)).toBe(
    "Raw D-Bus error: permission denied",
  );
});
