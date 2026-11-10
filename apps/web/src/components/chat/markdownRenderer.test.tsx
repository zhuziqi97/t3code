import {
  CHAT_MARKDOWN_REHYPE_PLUGINS,
  CHAT_MARKDOWN_REMARK_PLUGINS,
} from "@t3tools/shared/markdownPipeline";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vite-plus/test";

import { createIncrementalMarkdownPlugin } from "../../markdown-incremental";
import { createMarkdownRenderer } from "./markdownRenderer";
import { markdownUrlTransform } from "../../markdown-links";

// Visible in the markup, so every URL attribute must pass through it.
const urlTransform = (url: string) => `${url}#seen`;

describe("createMarkdownRenderer", () => {
  const render = createMarkdownRenderer({
    remarkPlugins: CHAT_MARKDOWN_REMARK_PLUGINS,
    rehypePlugins: CHAT_MARKDOWN_REHYPE_PLUGINS,
    components: {},
    urlTransform,
  });

  it.each([
    '# Title\n\nText with `code`, **bold**, [a link](https://example.com "t") and https://bare.example.com.',
    "![shot](./shot.png) and [file](file:///C:/repo/a.ts) and [bad](javascript:alert(1))",
    "<details><summary>More</summary>\n\nHidden <b>bold</b> <script>x()</script>\n\n</details>",
    "| a | b |\n| - | - |\n| <br> | [x](#frag) |\n\n- [ ] task\n- [x] done",
    '```ts title="a.ts"\nconst a = 1;\n```\n\n> [!WARNING]\n> careful <a>bare</a>',
    "Footnote[^1] and ~~strike~~\n\n[^1]: the note",
    // Each GFM construct the parser skips when its text cannot match, next to one that can.
    "Mail me@example.com, see www.example.com and HTTPS://example.com/a, not [x](https://y.z).",
    "a.b-c_d+e@x.io and @user\n\n`me@x.io` <me@x.io>",
    "A table without pipes\n:--",
    "> | quoted |\n> | - |\n> | body |\n\n- [ ] open\n- [X] done",
    "Escaped www\\.example.com and me&#64;example.com",
    "\ufeffA byte order mark\n\n| a |\n| - |\n| b |",
    "> - | a |\r\n>   | - |\r\n>   | me@x.io |\r\n\n-\t[ ] tab\n\n  ~~lazy~~",
  ])("renders what react-markdown renders: %j", (source) => {
    const expected = renderToStaticMarkup(
      <ReactMarkdown
        remarkPlugins={CHAT_MARKDOWN_REMARK_PLUGINS}
        rehypePlugins={CHAT_MARKDOWN_REHYPE_PLUGINS}
        urlTransform={urlTransform}
      >
        {source}
      </ReactMarkdown>,
    );
    const element = render(source, true);
    expect(renderToStaticMarkup(element)).toBe(expected);
    expect(render(source, true)).toBe(element);
  });

  it("preserves Convene issue and comment links through the final chat URL transform", () => {
    const issue = "convene://issues/zzq/software-factory/convene/313";
    const comment = `${issue}/comments/10`;
    const renderChatLinks = createMarkdownRenderer({
      remarkPlugins: CHAT_MARKDOWN_REMARK_PLUGINS,
      rehypePlugins: CHAT_MARKDOWN_REHYPE_PLUGINS,
      components: {},
      urlTransform: markdownUrlTransform,
    });
    const html = renderToStaticMarkup(
      renderChatLinks(
        `[Issue](<${issue}>) [Comment](<${comment}>) [Web](https://example.com) [Blocked](<javascript:alert(1)>)`,
        false,
      ),
    );
    expect(html).toContain(`href="${issue}"`);
    expect(html).toContain(`href="${comment}"`);
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("javascript:");
  });

  it("renders what react-markdown renders while a reply streams through the incremental parser", () => {
    const reply =
      "```ts\nconst a = 1;\n```\n\n| a | b |\n| - | - |\n| me@x.io | www.x.io |\n\nDone ~~now~~.";
    // As ChatMarkdown streams: one incremental plugin for the reply, a fresh renderer per update.
    const incremental = createIncrementalMarkdownPlugin();
    for (let end = 1; end <= reply.length; end++) {
      const source = reply.slice(0, end);
      const streamed = createMarkdownRenderer({
        remarkPlugins: [...CHAT_MARKDOWN_REMARK_PLUGINS, incremental],
        rehypePlugins: CHAT_MARKDOWN_REHYPE_PLUGINS,
        components: {},
        urlTransform,
      })(source, false);
      expect(renderToStaticMarkup(streamed)).toBe(
        renderToStaticMarkup(
          <ReactMarkdown
            remarkPlugins={CHAT_MARKDOWN_REMARK_PLUGINS}
            rehypePlugins={CHAT_MARKDOWN_REHYPE_PLUGINS}
            urlTransform={urlTransform}
          >
            {source}
          </ReactMarkdown>,
        ),
      );
    }
  });

  it("keeps cached messages when one far larger than the cache is rendered", () => {
    const element = render("Kept *message*", true);
    render("x".repeat(600_000), true);
    expect(render("Kept *message*", true)).toBe(element);
  });
});
