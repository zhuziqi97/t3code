# Triage an issue

Triage lets your own coding agent investigate a T3 Code problem. The agent
reads the logs and state of the machine, checks the T3 Code source for that
version, finds known issues, and helps draft feedback for the Convene T3 Code
module. You can explicitly choose upstream GitHub feedback instead. It asks
before applying a fix or posting anything. If the exact build source cannot be
matched, the diagnosis says so.

## In the app

Open the command palette and choose **Triage an issue**. A new thread with no
project opens, with the triage playbook linked in the message. Choose any
provider, describe what went wrong after the link, and send. T3 Code gets the
source for the server's version while you write.

Triage runs on the machine of the thread or draft that you have open. With
nothing open, it uses your primary machine if that supports triage, or else the
first connected machine that does. The new thread shows the machine name, and on
mobile the palette row shows it before you start. The agent runs inside that T3
Code server, so it gives you any restart steps and does not do them itself.

## In a terminal

If the app does not start, or triage does not work in the app, run:

```sh
t3code-convene triage
```

It starts Claude Code or Codex in your terminal with the same instructions.
