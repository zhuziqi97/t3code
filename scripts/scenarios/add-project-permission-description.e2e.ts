import * as Schema from "effect/Schema";
import { expect } from "e2e";

import { T3_HOME } from "../e2e.config.ts";
import { makeState, runPromise, test, WEB } from "./t3.ts";

const decodePairingCredential = Schema.decodeSync(
  Schema.fromJsonString(Schema.Struct({ credential: Schema.String })),
);

test(
  "The add-project input describes why a read-only connection cannot submit",
  WEB,
  async ({ t3, app, screen }) => {
    await t3.project("permission-description");
    const { cli } = makeState(T3_HOME);
    const { stdout } = await runPromise(
      cli([
        "auth",
        "pairing",
        "create",
        "--scope",
        "orchestration:read",
        "--scope",
        "filesystem:read",
        "--json",
      ]),
    );
    const { credential } = decodePairingCredential(stdout);
    await app.open(`/pair#token=${encodeURIComponent(credential)}`);

    await screen.getByRole("button", "添加项目").tap();
    await screen.getByText("本地文件夹").tap();
    const input = screen.getByRole("combobox");
    const submit = screen.getByRole("button", /添加 \(Enter\)|此连接没有添加项目的权限。/);
    await expect(submit).toBeDisabled();
    expect(await input.getAttribute("aria-describedby")).toBe(await submit.getAttribute("id"));
    await app.screenshot("permission-blocked-folder");
    await expect(submit).toHaveAccessibleName("此连接没有添加项目的权限。");
  },
);
