# Convene

**T3 Code for Convene** installs alongside T3 Code. Its desktop data is stored in `~/.convene-code`, with a separate desktop profile and `t3code-convene://` links. An explicit `T3CODE_HOME` still selects a different data directory. Existing T3 Code data is not imported automatically.

In **Settings → General**, install the `t3code-convene` command to run the bundled CLI from a terminal. The original `t3` command remains separate. Download the Convene installer from the platform's T3 Code help page and keep the data directory when updating. The Convene build has no automatic update feed. Windows and macOS packages are previews.

Connecting Convene is optional. Local projects, providers and sessions remain available without it.

During first setup, the **Convene** step follows agent setup. You can skip it and connect later from **Settings → Convene**, beside **Connections**. The main sidebar shows the connection status for each environment and links to its settings. Enter the platform URL, then open or copy the pairing link. It prefills the code and preserves it through login. Confirm authorization in Convene; T3 checks automatically and completes the connection. You can also copy the code separately. Cancel to stop waiting, retry a failed check, or request a new code after expiration. Pairing and reconnecting do not restart the T3 server.

**Disconnect Convene** unpairs that environment and removes its platform associations and MCP configuration. It closes its platform access, while local projects and provider sessions remain available. Pairing again creates a new platform client and requires configuring its projects again.

Adding a folder, creating a project or starting a clone offers optional Convene configuration after the native project has been created. Closing the dialog or a platform failure keeps the native project. Reopen it from **Settings → choose the project → Project → Configure Convene**. Grouped repositories configure each native project and environment separately.

An **execution association** connects a native project to a Convene module. A project can associate several modules, and a module can associate projects on several clients. Select a project folder or reported Git worktree, then explicitly activate it. Each module has one active location across the owner's clients; activating another location moves that module's execution there. Association, selection, activation, deactivation and removal are separate operations.

Git subdirectory projects remain scoped to the same subdirectory in each worktree. Removed worktrees stay unavailable. A checkout recreated at the same path is a new location; it cannot take over existing native sessions. Refresh the configuration to report workspace changes immediately.

Project configuration has separate **Module bindings** and **Convene MCP** tabs. Bind modules for execution, or configure MCP without any binding. The module browser shows projects beside their modules and keeps selections from different projects together. MCP access and tools can be configured while disabled; switching tabs retains the draft. **Save and finish** saves MCP changes before closing; a failed save keeps the page open. **Set up later** keeps unsaved input for reopening.

**Project MCP** is independent of execution associations. New projects start disabled with an empty scope. Select modules from any accessible platform project, choose Read or Write, and configure repository, code graph and issue capabilities. **Confirm selection** in the module picker updates the local draft; **Save settings** saves it to Convene. Canceling the picker leaves the draft unchanged. Refresh, closing and reopening the dialog, and platform failures retain an unsaved draft on that device. An unchanged draft cannot be submitted.

Cached configuration remains readable while unavailable. Platform writes require a current configuration and a connected environment. There is no automatic offline write replay: reconnect, refresh and explicitly retry. The platform enforces saved MCP access, including permission reductions; configuration changes do not restart active provider processes.

To reload MCP after changing its setup, or if a connection still fails after recovery,
use **Restart agent session** in the web or desktop command palette. Your next message
reopens the agent with the updated setup and keeps the conversation. Refreshing the
browser page does not restart the agent.

Convene execution currently supports native Codex and Claude providers. Other providers keep their upstream native functionality without a Convene execution support claim.
