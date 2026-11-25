import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { createMarkdownRenderer } from "./markdownRenderer";
import { markdownUrlTransform } from "../../markdown-links";

// Visible in the markup, so every URL attribute must pass through it.
const urlTransform = (url: string) => `${url}#seen`;

describe("createMarkdownRenderer", () => {
  const renderer = createMarkdownRenderer({
    markdown: { math: false, breaks: false, escapeHtml: false, insights: false, extensions: {} },
    components: {},
    urlTransform,
  });
  const render = (text: string) => renderer.element(renderer.parse(text));
  const renderAndRemember = (text: string) => {
    const entry = renderer.parse(text);
    renderer.remember(text, entry);
    return renderer.element(entry);
  };

  it("passes every URL attribute through the transform", () => {
    const html = renderToStaticMarkup(
      render('![shot](./shot.png) and [a link](https://example.com "t") and <img src="b.png">'),
    );
    expect(html).toContain('src="./shot.png#seen"');
    expect(html).toContain('href="https://example.com#seen"');
    expect(html).toContain('src="b.png#seen"');
  });

  it("preserves Convene issue and comment links through the final chat URL transform", () => {
    const issue = "convene://issues/zzq/software-factory/convene/313";
    const comment = `${issue}/comments/10`;
    const renderChatLinks = createMarkdownRenderer({
      markdown: { math: false, breaks: false, escapeHtml: false, insights: false, extensions: {} },
      components: {},
      urlTransform: markdownUrlTransform,
    });
    const html = renderToStaticMarkup(
      renderChatLinks.element(
        renderChatLinks.parse(
          `[Issue](<${issue}>) [Comment](<${comment}>) [Web](https://example.com) [Blocked](<javascript:alert(1)>)`,
        ),
      ),
    );
    expect(html).toContain(`href="${issue}"`);
    expect(html).toContain(`href="${comment}"`);
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("javascript:");
  });

  it("reuses a remembered message's element", () => {
    const element = renderAndRemember("# Title\n\nText with `code` and **bold**.");
    expect(render("# Title\n\nText with `code` and **bold**.")).toBe(element);
  });

  it("keeps cached messages when one far larger than the cache is rendered", () => {
    const element = renderAndRemember("Kept *message*");
    renderAndRemember("x".repeat(600_000));
    expect(render("Kept *message*")).toBe(element);
  });
});
