# Updating T3 Code for Convene

The desktop app checks the Convene platform paired with this computer's primary
environment when the connection is configured, then periodically while it runs.
You can also check from **Settings → About**. The sidebar reminds you when that
platform offers a newer version. Checking does not interrupt your agents.

## Download and install

Choose **Go to download** to open the package for your operating system,
architecture and installation type. The link stays on the exact build that was
checked. Save your work and install it when you are ready; an update reminder
does not install software or restart the app. On Linux, DEB installations receive
a DEB link and AppImage installations receive an AppImage link. If no matching
package is published, open **Platform downloads** for the available packages.

An older client without update reminders needs one manual download from
**Convene → Help → Desktop client** before it can check for future releases.

## Linux menu entries after an Alpha or Beta upgrade

The next DEB release uses `/opt/t3code-convene/t3code-convene` regardless of its
version or Beta/Nightly display name. The recovery steps below are pending
verification with that release's candidate package.

1. Finish installing the new DEB. Launch `/opt/t3code-convene/t3code-convene`
   as your normal user to confirm the new installation opens. This also refreshes
   the app's own hidden URL handler entry.
2. If a copied shortcut or user menu entry still names an old
   `/opt/T3 Code for Convene (Alpha)/` or `(Beta)/` directory, back up that specific
   T3 entry, then correct its `Exec` to
   `Exec=/opt/t3code-convene/t3code-convene %U`. Correct an old `TryExec` too, if
   present. A user entry in `${XDG_DATA_HOME:-$HOME/.local/share}/applications`
   can override the system entry. Only edit or move aside the identified T3 file;
   reinstall the DEB to restore a missing system entry.
3. After correcting the entry, refresh desktop registration with
   `update-desktop-database "${XDG_DATA_HOME:-$HOME/.local/share}/applications"`.
   To refresh the DEB's system registration, use
   `sudo update-desktop-database /usr/share/applications`. These commands are
   provided by `desktop-file-utils`.
4. Remove the old T3 item from GNOME favorites, find the updated application in
   the menu, and pin it again. If GNOME still shows the old item, log out and back in.

Refreshing registration cannot rewrite an incorrect `Exec`. Fix or recreate the
entry first; refreshing the MIME database alone does not repair copied shortcuts
or GNOME favorites. Keep your T3 data, sessions, projects, credentials and desktop
profile. AppImage locations remain your choice; update their integration entry
to the actual AppImage path instead of using the DEB path above.

## Where updates come from

The source is the Convene platform paired with this desktop's primary environment.
Browsing a remote computer, project or WSL environment does not change it. Pairing
the primary environment with another platform clears the old result and checks
the new source. If it is not paired, connect it in **Settings → Convene** first.
Checks do not fall back to a preset platform or to upstream downloads.

The settings page shows the source, published version and last check. A failed
check is reported as a failure. The platform may offer an older version, or a
different build with the same display version; a different build is not ordered
as a newer version. Decide whether to download that revision yourself.

## Other machines and provider updates

The app and the server running your agents can be on different machines. A
version mismatch notice names the machine that needs an update. Updating this
desktop also replaces its bundled server. A separately installed server must be
updated on its own host using its installation method.

The sidebar's **Update everything** can update providers and servers that support
that operation. Convene desktop packages require manual installation and are not
included in automatic download, restart or remote install steps. Check which
machines the confirmation lists before starting other updates: those operations
can interrupt their active agents and terminals.
**Settings → Maintenance → Continue threads after restarts** is on by default.
It resumes supported active threads after an update, crash, or machine
restart. Changes are saved to connected environments that support this setting;
update older servers first. If a supported environment was offline or has a
different value, use **Apply to all** in Settings after it connects.
T3 Code must start again on that machine;
the setting does not enable automatic startup. Terminal commands may still be
interrupted, and threads without saved provider resume state need a new message.
A thread that finished its turn to wait on a subagent, a background task, or a
command or monitor the agent said it was waiting on is woken and told that this work
stopped. Other background shells and monitors, such as a dev server and its
watchdog, do not wake it; the thread learns about them with your next message.
A thread is not resumed while it waits for your approval, answer, or secret, or
while it is archived, snoozed, or settled. After three automatic resumes in a row,
the thread waits for your next message.

Updates from the previous orchestration system preserve conversation transcripts but cannot carry
every kind of runtime history forward. Read [Threads from older T3 Code versions](./thread-migration.md)
before continuing an important older thread.

## When versions don't match

A client and server must speak the same orchestration protocol. If they do not, the connection is
refused rather than running half-upgraded:

- An app newer than the server is blocked before connecting, with a notice telling you to update
  T3 Code on the machine named in the notice.
- A server newer than your app refuses the connection with an update message.

Update the side the notice names, then reconnect.

## Update a connected server

The offered action depends on how the server runs:

| Action                     | What to do                                                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Update server**          | Keep the client open while it installs and reconnects. Supported background services update remotely. For a desktop-hosted server, this also closes and relaunches the desktop app on the host. |
| **Update the desktop app** | Update the desktop app on the machine running the server, then reopen it if needed.                                                                                                             |
| **Copy update command**    | Run the command on the named host to update the detected global npm install, then restart the server with your usual options.                                                                   |
| **Copy relaunch command**  | Stop the command-line server on its host and relaunch with the copied command, keeping your usual subcommand and options. This does not update an installed `t3` command.                       |

On the host, run:

```sh
t3 update <client-version>
```

Replace `<client-version>` with the version shown in the notice. The command
asks before restarting the background service; if you decline, run
`t3 service restart` when you are ready. For a server you started by hand,
stop it and start it again afterwards with your usual options such as `--host`
or `--tailscale-serve`.

If you run the server with `npx` rather than an installed `t3`, there is
nothing to update on the host: stop the server and relaunch it as
`npx t3@<client-version>` with the same subcommand and options.

## If an update fails

Keep the client open until it reconnects or reports a failure. A failed service
update can roll back to the previous version. If the update still fails:

1. Retry the offered action once.
2. Check that you updated the server's machine, not only the device you are using.
3. For a command-line server, stop it and relaunch the exact version shown in the notice.

Only one server can use a T3 home directory at a time. If startup reports that
another server owns it, stop that server before retrying, or use a separate home
directory and pair with the running server.

## Update providers

**Settings → Providers** shows provider updates for the selected environment.
**Update all** updates every outdated provider on every connected environment
at once. Hover it to see which providers it will update. Providers that only
offer a manual update command are not included.

After a successful provider CLI update, T3 Code refreshes model discovery for
every enabled instance of that provider using its own configuration. Connected
clients receive the refreshed catalogs automatically. Provider update checks
must be enabled to download the latest T3 Code model catalog.

Provider updates do not restart running chats. An existing session can keep
using the previous CLI until it ends. If discovery fails, check the provider
status and refresh it again.

## Mobile updates

To update an environment from your phone, open **Settings → Environments** and
select it. **Check for updates** finds the latest release on that environment's
current release channel. Keep the app open while the environment updates and
reconnects. Hosts that cannot update remotely show instructions for updating on
the machine instead.

The same page lets you refresh provider status and update supported providers.
These controls require a connected environment and permission to operate it.
Provider update checks and restart continuation preferences are in
**Settings → Maintenance**. If provider update checks are disabled, enable them
there before refreshing to find newer versions. The same setting controls whether
T3 Code downloads model catalog updates, so with it off new models may not appear
until you enable it and refresh provider status.

Install App Store or Google Play releases as usual. The mobile app can also
download updates in the background and apply them when you next leave the app.
It saves drafts and queued messages before restarting. If you keep the app open
for a long time, it may ask to install immediately; choosing **Later** leaves the
update queued for the next suitable moment.
