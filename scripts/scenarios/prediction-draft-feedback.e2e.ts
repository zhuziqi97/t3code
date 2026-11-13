import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "The prediction shortcut explains an unsent draft instead of silently returning",
  WEB,
  async ({ t3, app, screen, browser }) => {
    await t3.project("prediction-feedback");
    await t3.open();

    await screen.getByRole("textbox").tap();
    await browser.keyboard.press("Alt+Enter");
    await app.screenshot("prediction-draft-feedback");
    await expect(
      screen.getByText(
        /请在已完成轮次的会话中请求预测。|Open a completed conversation to request a prediction\./,
      ),
    ).toBeVisible();
  },
);
