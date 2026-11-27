# Triage an issue

Triage lets your own coding agent investigate a T3 Code problem. The agent
reads the logs and state of the machine, checks the T3 Code source for that
version, finds known issues, and helps draft feedback for the Convene T3 Code
module. You can explicitly choose upstream GitHub feedback instead. It asks
before applying a fix or posting anything. If the exact build source cannot be
matched, the diagnosis says so.

## In the app

Open the command palette (`Cmd/Ctrl+K`) and run **Triage an issue**. A no-project thread opens on the active machine with the triage playbook attached—pick any provider, describe the problem, and send.

## In a terminal

If the app won't start or in-app triage fails, run:

```sh
t3code-convene triage
```

It starts Claude Code, Codex, or Antigravity in your terminal with the same
instructions. If more than one is installed, it asks which to use. You can also
choose explicitly:

```sh
npx t3 triage --agent antigravity
```

Supports Claude Code, Codex, and standalone Antigravity (`agy` on `PATH` with its own sign-in; T3's managed ACP runtime does not include the standalone terminal CLI).
