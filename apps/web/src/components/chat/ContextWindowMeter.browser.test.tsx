import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { changeLanguage } from "../../i18n";
import { deriveLatestContextWindowSnapshot } from "../../lib/contextWindow";
import * as DateTime from "effect/DateTime";
import { ContextWindowMeter } from "./ContextWindowMeter";
import "../../index.css";

it.each(["en", "zh"] as const)(
  "shows unknown, real zero and current provider details in %s",
  async (language) => {
    await changeLanguage(language);
    const unknown = language === "zh" ? "未知" : "Unknown";
    const label = language === "zh" ? "上下文窗口" : "Context Window";
    const snapshot = (usedTokens: number) =>
      deriveLatestContextWindowSnapshot([], undefined, {
        contextUsage: {
          usedTokens,
          maxTokens: 10_000,
          totalProcessedTokens: 45_000,
          cost: { amount: 0.42, currency: "USD" },
        },
        updatedAt: DateTime.makeUnsafe("2026-10-23T00:00:00Z"),
      });
    // The meter has no navigation or RPC dependency.
    await using screen = await render(
      <div style={{ width: 280 }}>
        <ContextWindowMeter usage={null} />
      </div>,
      { router: false },
    );
    const trigger = screen.getByRole("button", { name: label });
    await expect.element(trigger).toHaveTextContent(`${unknown} / ${unknown} · ${unknown}`);
    await screen.rerender(
      <div style={{ width: 280 }}>
        <ContextWindowMeter usage={snapshot(0)} />
      </div>,
    );
    await expect.element(trigger).toHaveTextContent("0 / 10k · 0%");
    await userEvent.click(trigger);
    await expect.element(page.getByText("45k", { exact: true })).toBeVisible();
    await expect.element(page.getByText("USD 0.42", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await screen.rerender(
      <div style={{ width: 280 }}>
        <ContextWindowMeter usage={null} />
      </div>,
    );
    await expect.element(trigger).toHaveTextContent(`${unknown} / ${unknown} · ${unknown}`);
    await screen.rerender(
      <div style={{ width: 700 }}>
        <ContextWindowMeter usage={snapshot(2500)} />
      </div>,
    );
    await expect.element(trigger).toHaveTextContent("2.5k / 10k · 25%");
    const button = screen.container.querySelector("button")!;
    expect(button.getBoundingClientRect().width).toBeLessThanOrEqual(280);
    await changeLanguage("en");
  },
);
