import { render, stubGlobal } from "../../../test/render";
import { EnvironmentId, type DesktopFileDownloadInput } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import "~/index.css";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn<() => Promise<string | null>>() }));
vi.mock(import("~/assets/assetUrls"), async (original) => ({
  ...(await original()),
  useAssetUrlRefresh: () => refresh,
}));
import { AttachmentFilePreview } from "./AttachmentFilePreview";

it.each(["web", "desktop"] as const)(
  "hands a remote RAR to %s downloads without prefetching its body",
  async (client) => {
    const url = "https://environment.test/assets/large.part1.rar";
    refresh.mockResolvedValue(url);
    await using screen = await render(
      <AttachmentFilePreview
        name="large.part1.rar"
        mimeType="application/octet-stream"
        sizeBytes={512 * 1024 * 1024}
        asset={{ environmentId: EnvironmentId.make("test"), attachmentId: "large-file" }}
      />,
    );
    using _frame = {
      [Symbol.dispose]: () => document.getElementById("t3-file-download")?.remove(),
    };
    const fetch = vi.fn(async () => {
      throw new Error("Renderer must not fetch the file body");
    });
    using _fetch = stubGlobal("fetch", fetch);
    const downloadFile = vi.fn(async (_input: DesktopFileDownloadInput) => "completed" as const);
    using _bridge = stubGlobal(
      "desktopBridge",
      client === "desktop" ? { downloadFile } : undefined,
    );
    const anchors: HTMLAnchorElement[] = [];
    using click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      anchors.push(this);
    });
    await screen.getByRole("button", { name: "Save file", exact: true }).click();
    if (client === "desktop") {
      await vi.waitFor(() => expect(downloadFile).toHaveBeenCalledOnce());
      expect(downloadFile.mock.calls[0]?.[0]).toMatchObject({ url, name: "large.part1.rar" });
      await expect.element(screen.getByRole("status")).toHaveTextContent("Download complete");
      expect(click).not.toHaveBeenCalled();
    } else {
      await vi.waitFor(() => expect(click).toHaveBeenCalledOnce());
      const anchor = anchors[0];
      expect(anchor?.href).toBe(url);
      expect(document.getElementById(anchor!.target)?.tagName).toBe("IFRAME");
      await expect
        .element(screen.getByRole("status"))
        .toHaveTextContent("Download started. Check your browser’s downloads.");
    }
    expect(fetch).not.toHaveBeenCalled();
    await expect.element(screen.getByText("large.part1.rar", { exact: true })).toBeVisible();
  },
);
