# Messages and context

Use the composer to send prompts, attach files, reference threads or pull requests, invoke skills, and steer or queue follow-ups.

## Limits and large pastes

- **Message length**: Up to 120,000 characters.
- **Large pastes**: Pasting 32 KiB+ of text (or any paste that would exceed the message limit) turns it into a text-file attachment so it doesn't bloat the prompt. Use `Cmd+Shift+V` (Apple) or `Ctrl+Shift+V` (Windows/Linux) to paste inline instead.

## Codex predictions (experimental)

Choose a mode in **Settings → Chat → Codex native predictions** on each client.
**Off** is the default. **Manual** requests a suggestion only through a shortcut;
**Automatic** also requests one after an eligible Codex turn finishes or when
returning to a completed thread. Existing enabled settings remain Automatic.
This requires a system Codex CLI with native sampling support (stable 0.165 or
newer). Free access through third-party clients is unconfirmed. Predictions may
consume subscription allowance or incur charges, and a request does not guarantee
a suggestion.

On web and desktop, focus an empty composer after a Codex turn completes and press
**Alt+Enter** (**Option+Return** on Mac) to request or redisplay a suggestion in
Manual or Automatic mode. Rebind `chat.requestPrediction` in **Settings → Keybindings**.
Text, attachments, composition input and open completion menus keep their normal
editing behavior; the shortcut does not clear them to make room for a prediction.
**Tab** fills the editable draft without sending. **Esc** cancels a pending request
or hides the suggestion, after input methods and menus have handled it.

Pressing the request shortcut while waiting shares the pending request. An existing
valid suggestion, including one hidden with Esc, is redisplayed without generating
another. After no suggestion, an error or cancellation, an explicit request may
retry and incur a new native request. Automatic prediction still tries once per
source turn. An official restriction, unsupported model or a turn that was not
selected cannot be bypassed by repeatedly pressing the shortcut.

Mobile keeps Automatic and Off settings, touch acceptance and **View full suggestion**.
It has no touch gesture for a manual request in this version. If its saved mode is
Manual, it preserves that mode without automatic requests and explains how to use
web or desktop; you can explicitly choose Automatic or Off instead.
**Use as draft** fills an editable draft for you to review and send yourself.
Starting to type, adding context, switching threads or changing the source turn
invalidates the old request; a late result cannot replace your draft.

## Formatting

The composer renders Markdown live as you type and reveals raw markers when your cursor enters styled text. The agent receives the exact Markdown you typed.

- Disable live styling in **Settings → Chat → Rich text composer**.
- Standard Markdown triggers (`- `, `1. `, `- [ ] `, `> `, `# `, `---`, and ` ``` ` + Enter) create lists, quotes, headings, rules, and code blocks.
- In lists/quotes, `Shift+Enter` continues (or exits on an empty line), and `Tab` / `Shift+Tab` indents or outdents.
- In code blocks, `Enter` keeps indentation, `Tab` / `Shift+Tab` indents selected lines, and closing ` ``` ` + Enter (or two blank lines) exits the block.

## Attach files

Attach up to **100 files** per message:

- **Images**: Up to 10 MiB each, 80 MiB total per message. HEIC/HEIF photos are converted to JPEG, and oversized photos are resized automatically.
- **Other files (including videos)**: Up to 50 MiB each (subject to environment limits). Video attachments pass a file path; only [Antigravity](./providers-antigravity.md#skills-and-attachments) sends supported videos natively to Gemini models.

Files upload to the environment's machine as soon as you attach them, and all uploads must finish before sending. Provider and model limits still apply.

- **Web and desktop**: Drag, paste, or pick files. Reloading before an upload finishes requires re-attaching.
- **Mobile**: Pick files, share into T3 Code via the system share sheet, or drag images in Android split screen.

See [images and videos](#images-and-videos-in-messages) for previewing and saving media.

## Send while the agent is working

Choose your default follow-up behavior in **Settings → Chat → Follow-up behavior** (per client):

- **Queue**: Holds the message on the server for the next turn.
- **Steer**: Injects the message into the running turn (when supported by the agent).

Shortcuts while a turn is running:

- **Opposite action**: `Cmd+Enter` (macOS) or `Ctrl+Enter` (Windows/Linux) uses the non-default action. If your send shortcut already requires `Cmd/Ctrl+Enter`, add `Shift`. On mobile, long-press the send button or use `Cmd/Ctrl+Return` on a hardware keyboard.
- **Steer oldest queued message**: `Cmd+Shift+Enter` (macOS) or `Ctrl+Shift+Enter` (Windows/Linux) sends the first queued message as a steer without touching your current draft. Remap `thread.steerQueuedMessage` in **Settings → Keybindings**, or add a rule in your [keybindings file](./keybindings.md#edit-the-configuration-file) to trigger it on `mod+enter` when the composer is empty:

```json
{
  "key": "mod+enter",
  "command": "thread.steerQueuedMessage",
  "when": "composerFocus && turnRunning && composerEmpty"
}
```

- **Edit most recently queued message**: `Option+Up` (macOS) or `Alt+Up` (Windows/Linux) at the start of the composer (`thread.editQueuedMessage`).

Slash commands (such as `/compact` or `/context`) wait for the current turn to finish rather than steering into it. [Goal](#goals) commands are the exception.

## Queue messages offline on mobile

Mobile keeps local copies of draft attachments so you can preview them and queue messages offline. Uploads resume on reconnect, and drafts/queued messages survive app restarts and T3 Connect sign-out (restored when signing back into the same account).

## Custom models and defaults

- **Remembered defaults**: T3 Code remembers your last provider, model, and options for new threads. A project's configured model overrides this. Leaving reasoning level or service tier unset uses the provider's default.
- **Custom models**: Add unlisted models in **Settings → Providers → Models** (web and desktop; not supported for Antigravity, which uses its account catalog).
- **Rename a built-in model across all clients**: Add an entry in the server's `userdata/settings.json`:

```json
{
  "providerInstances": {
    "codex": {
      "driver": "codex",
      "config": { "customModels": [{ "slug": "gpt-5.5", "name": "Team GPT" }] }
    }
  }
}
```

## Quote an assistant response

- **Web and desktop**: Select text in an assistant message and click **Cite in composer**. Click the pencil on the chip to add or edit a comment; click the chip to jump back to the source.
- **Mobile**: Long-press an assistant response, select text, and tap **Cite**. Tap a quote chip to edit its comment, remove it, or jump to the source message.

Quoted text and comments count toward the message length limit and are preserved across copy/paste and [stashed prompts](#prompt-stash).

## Recall a sent prompt

Press `ArrowUp` in an empty composer to cycle backward through earlier prompts in the thread, and `ArrowDown` to move forward. Only prompt text is restored (not attachments or context chips). Editing a recalled prompt turns it into a normal draft.

## Suggested next prompt

Enable **Settings → Labs → Suggest next prompt** (web and desktop) to show a predicted next message in the empty composer after a Claude or Codex turn completes.

- Press `Tab` to accept or `Escape` to dismiss.
- Each suggestion uses one cached request against your plan's usage. Claude skips suggestions on the first turn and near usage limits.
- Codex requires CLI version 0.165+ (update in **Settings → Providers**). Open Claude threads pick up the setting after restarting.

## Edit an earlier prompt

On web and desktop, select **Edit from here** under a sent message to rewind the conversation to before that message and return it to the composer:

- **Revert and keep changes**: Rewinds the conversation only.
- **Revert files too**: Restores workspace files to the checkpoint before that message (including your own edits). Only available for worktree threads when no other thread or active session shares that directory.

Rewinding removes later messages from the active thread and provider history (requires provider rewind support), but cannot undo external actions or separate provider memory.

## Prompt stash

On web and desktop, press `Cmd+S` (macOS) or `Ctrl+S` (Windows/Linux) to stash the current draft and its attachments (wait for uploads to finish first). Press the same shortcut in an empty composer to restore the stash (or open the stash menu if you have multiple).

- Holds up to 100 prompts in browser storage; stashes are never auto-deleted.
- Stashes with uploaded files must be restored in their original environment. Uploads expire after 24 hours; use **Attach again** or remove expired files before sending.

## Voice input

Dictate into the composer with the microphone button or `mod+shift+d` (web and desktop). Audio stays on-device or goes only to an environment/provider you explicitly choose in **Settings → Voice**. See [Voice input](./voice-input.md) for setup, mobile dictation, and microphone priority.

## Queued messages

Queued messages appear at the end of the thread (web/desktop) or above the composer (mobile). From a queued message you can:

- **Send now**: Injects it immediately into a running turn (or moves a slash command to the front of the queue).
- **Edit**: Opens the message and its attachments in the composer without losing your existing draft.
- **Remove**: Cancels the queued message.

If you stop the agent or the server restarts, queued messages pause in order. Click **Resume** in an empty composer (or send a new message) to continue. When the provider supports native continuation, **Resume** continues without sending a new prompt.

## Commands and skills

Type `/` for commands or `$` for skills from the selected environment and provider.

- Skills also appear in the `/` menu unless you disable **Settings → Chat → Show skills in slash menu** (under Advanced).
- Provider commands must start the message; T3 Code commands (like `/model`) and `$` skills work on any line.
- `/compact` reduces context usage when supported by the provider.
- `/clear` starts a fresh provider session in the same thread (earlier messages and diffs stay visible above a **New session** divider).
- After adding or changing skills, plugins, or MCP servers, run **Restart agent session** from the command palette so your next message picks up the new config.
- Turn on **Settings → Appearance → Thread details → Context window** to view reported context usage. For automatic idle compaction on Claude, see [compact long conversations](./providers-claude.md#compact-long-conversations).

## Goals

With Codex, Claude, and OpenCode 2.2.5+, send `/goal <criteria>` (for example, `/goal all tests in packages/api pass`) so the agent keeps working across turns until the goal is met.

- `/goal` shows the current goal; `/goal clear` removes it.
- Codex and OpenCode support `/goal pause` and `/goal resume` (stopping pauses the goal).
- On Claude, stopping ends the current turn but keeps the goal active for your next message.
- Sending a new goal or `/goal resume` while working interrupts the current turn unless queued; `/goal clear` and `/goal pause` interrupt only when the agent is actively working on the goal.

## Context in your message

Attached context—files, terminal excerpts, diff/file review comments, preview annotations, pull requests, and threads—appears as inline chips at your cursor. Click a chip to inspect or open its source; copy/paste and [Prompt stash](#prompt-stash) preserve chips across drafts.

A pull request appears as its icon and number. Its color reflects whether it was open, draft,
merged, or closed when it was attached. Select it to inspect the captured title and branches,
then choose **Open pull request** to visit the pull request. On web and desktop, type `#` to browse the newest
pull requests in the current project's repository. Pull requests linked to the thread are included
from any repository and listed first, after any exact number match. Continue typing digits to filter the recent list
by any part of its pull request numbers. A complete number is also resolved directly, even when that
pull request is older than the recent list. Type a single word after `#` to search pull requests in
the repository by text. Choose a result to insert it as a chip.

Another thread can be context too. Type `@` followed by part of its title to pick one from
the same server, or from a machine it links to while the Linked environments beta is on; those
show the machine's name. On web and desktop you can also drag a thread out of the sidebar and
drop it on the composer; a multi-selection drops together. On any client, **Copy thread** copies a
thread reference that pastes into a composer as its chip. The chip shows the thread's
current title and opens it when selected. Your prompt only carries a reference: the agent reads the thread's
history on demand, so attaching a long thread costs nothing until the agent looks. Attaching a
thread does not change it, and the agent cannot send messages to it unless you ask.

A thread from a linked machine, picked, pasted or dropped, stays a reference that the agent reads
on that machine. A pasted link to a thread on any other machine stays a link. Dropping a thread
from any other environment attaches a saved transcript file. The source
environment must be connected and up to date. The transcript includes the visible history and
saved text context at the time of the drop; later messages and the contents of attached files
are not copied. The agent can read the saved transcript after the source disconnects. Normal
file attachment limits apply.

Type `@` and part of a model or provider name, such as `@opus`, to name that model for the
agent, for example when delegating. It does not change the thread's model. Join words with
`:`, `/` or `-`, as in `@opus:opencode`.

Images keep their thumbnail shelf above the text and also get a chip at your cursor, so you can
say exactly which image you mean. Deleting an image chip leaves the image on the shelf; removing
the thumbnail asks first when the image is still mentioned in your text, then removes both. Files
exist only as chips: deleting a file's last chip removes the file from the message.

Copy text that holds chips and paste it into another draft, in the same thread or another one,
and the chips come along with what they point to. Images and files are fetched again from the
environment they came from; while that happens the chip shows a dashed outline, and if it cannot
complete T3 Code tells you and leaves the chip for you to remove or replace. A chip whose
context is no longer available shows the same dashed outline; hover it for what to do.

Copying a message with the copy button, or copying text out of it, gives other apps readable
Markdown with a link in place of each chip. Older messages that were sent before chips still
show their context. Stashing a prompt keeps its chips and what they point to; restoring brings
them back.

On mobile, tap a chip to inspect its content. File references open the current file; attached
files show the copy that was attached to the message.

## Attached files

Select any file chip in a draft or sent message to preview it (syntax-highlighted code/JSON, rendered/raw Markdown/HTML/CSV/TSV, audio playback, and ZIP folder browsing up to 50 MB). Large text files show a truncated preview—save the file to read it in full.

## Images and videos in messages

Select an image or video attachment or link to preview it.

- **Web and desktop**: Right-click media to save it or copy its path/URL.
- **Mobile**: Long-press a thumbnail and choose **Save or share**.

File links point to the file on the environment's machine, so moving or deleting the original breaks the preview—save a copy if you need to keep it.

## Files outside the workspace

Following an agent's file link to a file outside the workspace opens it read-only. External HTML files cannot load neighboring scripts, styles, or images.

## HTML and PDF files in the file viewer

On web and desktop, HTML and PDF files open rendered (HTML previews are sandboxed from your T3 Code session; line-specific HTML links open source view). On mobile, PDFs open in the native iOS viewer or an installed Android viewer.
