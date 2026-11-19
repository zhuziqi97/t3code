import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "The prediction shortcut explains an unsent draft from the open model picker",
  WEB,
  async ({ t3, app, screen, browser }) => {
    await t3.project("prediction-feedback");
    await t3.open();

    await screen.getByRole("textbox").tap();
    await browser.locator("button[data-chat-provider-model-picker]").first().tap();
    await expect(browser.locator("[data-model-picker-content] input").first()).toBeFocused();
    await browser.keyboard.press("Alt+Enter");
    await app.screenshot("prediction-draft-feedback");
    await expect(
      screen.getByText(
        /请在已完成轮次的会话中请求预测。|Open a completed conversation to request a prediction\./,
      ),
    ).toBeVisible();
  },
);
