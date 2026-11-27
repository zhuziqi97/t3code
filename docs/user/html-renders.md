# Visual replies and MCP apps

Agents can render self-contained HTML visuals (charts, diagrams, tables, image collages, mockups) and interactive MCP Apps inline in a thread on web, desktop, and mobile.

## Visual replies (HTML renders)

Ask an agent for a visual (e.g. "show this as a chart" or "make a collage of these screenshots"). The rendered page appears above the agent's reply, adapts to your light/dark theme, and runs sandboxed away from your T3 Code session.

Before publishing, agents check their work with screenshots from a small headless browser that T3 Code keeps for itself; it never uses a browser you installed. Desktop installers and platform CLI packages include this browser component. The first preview unpacks it into T3 Code's data folder without an additional download. Browser tabs on the same environment reuse it. Source development builds can download the component on first use. Some Linux hosts need [setup](remote-access.md#browser-host-setup) before it can start. Pages publish without it.

Previews can load public resources such as CDN scripts, but nothing on your local network. The machine running the environment looks up each name, and previews block names that resolve to private or reserved addresses. Clash or Mihomo in fake-IP DNS mode can return these addresses, so external resources can fail there. The preview's console messages can identify affected hostnames. Inline the resource, add its host to `fake-ip-filter`, or switch that machine's proxy DNS to `redir-host`.

## MCP apps

MCP servers supporting the [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) standard render interactive UIs directly below their tool calls (supported on Codex and Claude Code 2.1.301+ on up-to-date T3 servers).

- **Safety**: T3 Code asks before an MCP app runs non-read-only server tools, posts messages to the thread, opens links (mobile), or saves files. Navigating away from its own page stops the app.
- **Session requirement**: Apps remain viewable after a turn ends, but interacting with them requires the thread's agent session to be running.
- **Full screen**: Expand an app full screen and press `Esc` (or the corner button) to return to the thread.
