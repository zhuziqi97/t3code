import "~/index.css";
import { expect, it, vi } from "vite-plus/test";

import { render, stubGlobal } from "../../../test/render";
import { OpenSourceLicensesPanel } from "./OpenSourceLicenses";

it("loads and opens notices from the matching immutable Web build", async () => {
  using _pageBase = stubGlobal("__T3_BASE_PATH__", "/deploy/clients/runner");
  using _requestBase = stubGlobal(
    "__T3_REQUEST_BASE_PATH__",
    "/deploy/clients/runner/_sessions/current",
  );
  using _assetBase = stubGlobal("__T3_ASSET_BASE_PATH__", "/deploy/t3-web/build-one/");
  using _fetch = stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), window.location.origin).pathname;
      return path === "/deploy/t3-web/build-one/third-party-licenses.json"
        ? Response.json({
            schemaVersion: 1,
            entries: [
              {
                bundles: ["web"],
                kind: "package",
                name: "Mounted license fixture",
                license: "MIT",
                noticeText: "Notice from the matching mounted build.",
                sourceUrl: null,
                version: "1.0.0",
              },
            ],
          })
        : new Response("Not found", { status: 404 });
    }),
  );
  await using screen = await render(<OpenSourceLicensesPanel />);
  await expect.element(screen.getByText("Mounted license fixture", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: /Mounted license fixture/ }).click();
  await expect
    .element(screen.getByText("Notice from the matching mounted build.", { exact: true }))
    .toBeVisible();
});
