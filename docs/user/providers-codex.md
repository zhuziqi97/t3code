# Codex

Use your ChatGPT plan or an existing Codex CLI login to run Codex in T3 Code.

## Connect with ChatGPT

Connect during onboarding or in **Settings → Providers** (select your target environment first for remote machines). T3 Code manages the Codex runtime and signs you in via OpenAI.

- Manage shared usage and credits through **Manage usage** in T3 Code.
- **Remote sign-in**: If sign-in doesn't return automatically, paste the full `localhost` redirect URL into the sign-in panel.
- **Speed options**: Fast and Ultrafast speeds are not available through ChatGPT sharing—[use an existing Codex login](#use-an-existing-codex-login) instead.
- Disconnecting stops running threads while preserving history.

## Use an existing Codex login

Run `codex login` on the environment's machine, then add a Codex instance in **Settings → Providers** via **Configure manually**. See [provider setup](./install.md#providers) for installation details.

If provider status checks time out on a slower machine, set `T3CODE_CODEX_PROBE_TIMEOUT_MS=60000` in the server environment and restart. See [Provider check timeouts](./install.md#provider-check-timeouts).

## Use multiple accounts

Add another ChatGPT account in **Settings → Providers**, or configure multiple CLI logins with a **shadow home** so work and personal accounts can continue the same threads:

```bash
mkdir -p ~/.codex_personal
CODEX_HOME=~/.codex_personal codex login
```

| Instance       | CODEX_HOME path | Shadow home path    |
| -------------- | --------------- | ------------------- |
| Codex Work     | `~/.codex`      | _(leave empty)_     |
| Codex Personal | `~/.codex`      | `~/.codex_personal` |

- Both instances must share the same **CODEX_HOME path**. Keep the shadow directory fresh—don't copy your full Codex home into it.
- The shadow account needs file-based credential storage (`auth.json`); see [OpenAI's credential storage guide](https://learn.chatgpt.com/docs/auth#credential-storage).
- Use a separate **CODEX_HOME path** (no shadow home) if you want completely isolated sessions.

To switch accounts mid-thread, pick another compatible Codex instance sharing the same **CODEX_HOME path** from the model picker.

## Features and options

- **Image generation**: Supported when your Codex version, model, and account allow it. If disabled in Codex config, add `-c features.image_generation=true` to the instance's **Launch arguments** (applies to new sessions).
- **Async questions**: Codex can ask a question while continuing to work; answer in the question panel (steers the active turn or starts a new one) or dismiss it without sending.
- **App access approvals**: Respond to external app access requests directly in chat (one-time, session, or permanent depending on the tool).
- **MCP OAuth sign-in**: Click **Sign in** on the thread notice, approve in your browser, and paste the final redirect URL into **Finish sign-in** (requires provider management permission).
- **Daybreak**: Models with cyber access programs show a **Cyber Access** option (`Standard` or `Daybreak`, initialized from `daybreak = true` in `config.toml`).
- **Usage limits**: Limit stops display the exhausted window, reset time, and (on workspace plans) whether credits or spend limits need adjustment.
- **Feedback to OpenAI**: Send `/feedback <description>` in an existing Codex thread to upload conversation and Codex logs to OpenAI.

## OpenAI Chrome extension

If the account is missing from the picker, compare the home paths in provider
settings. If two instances show the same unexpected account or models, check their
reported accounts, refresh provider status, and confirm the second instance has
its own shadow path and login. A shadow-home conflict usually means the directory
contains a copied Codex setup. Use a fresh shadow directory and sign in again.

## Answer questions while Codex works

Codex can ask a question and keep working. Answer it in the thread's question
panel. The answer becomes a new message: it reaches the active turn, or starts
another turn if Codex has finished. Unanswered questions survive reconnects.
If you do not want to answer, dismiss the question from its panel. Dismissing
closes it without sending anything to Codex. This requires a Codex version that
supports async questions.

## Approve app access

Codex tools can request access to another app. Respond to the named app's request
in the thread on web, desktop, or mobile. Some tools offer access for one request,
the current session, or permanently. See [Permission modes](./permission-modes.md)
for command and file approvals.

## Sign in to an MCP server

When an MCP server you added to Codex needs you to sign in, the thread shows a notice with
**Sign in**; on mobile, tap the notice. Approve access on the page it opens. Your browser then goes
to a page that may not load, especially when Codex runs on another machine: copy that page's
address, paste it into T3 Code, and choose **Finish sign-in**. Codex reconnects the server in that
thread and keeps the sign-in for other threads on the same Codex instance; an instance with its own
home, such as a second account, may need to sign in separately. Signing in needs permission to
manage providers.

## Use the OpenAI Chrome extension

Connecting ChatGPT in **Settings → Providers** signs in the Codex provider.
Using your signed-in Chrome profile through the extension requires a browser
connection for the current Codex thread.

If a T3 Code thread reports `The browser access host is unavailable`, its browser
host is unavailable; this does not identify an extension connection failure.
For a task that requested Chrome, follow [OpenAI's setup guide](https://learn.chatgpt.com/docs/chrome-extension),
then select Chrome in a Codex chat in the ChatGPT desktop app.
If the task runs on a remote environment, `localhost` in the desktop browser
refers to your computer. Forward the remote page's port or use a URL reachable
from your computer before repeating the task. Connecting to T3 Code through a
relay or tunnel does not by itself expose that page. T3 Code's built-in browser
preview uses its own browser session.

## Codex says I hit a usage limit

When Codex stops on a usage limit, the thread names the window that ran out and
when it resets, when Codex reports them. Send the message again after the reset. On a workspace plan the
message also says whether your workspace owner needs to add credits or raise the
spend limit to continue sooner.

## Send feedback to OpenAI

In an existing Codex thread, send `/feedback` with an optional description, for
example `/feedback The agent stopped before finishing the tests`. This uploads
the conversation and Codex logs to OpenAI. The returned thread ID can be shared
with OpenAI support.
