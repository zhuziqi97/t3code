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

Each server checks that it can install the release before it restarts. If the
release is not available to a server yet, its update fails, the server keeps
running, and you can retry. The confirmation lists each machine it skips and
why, such as a machine that is offline or needs a manual update. Use
**Settings → Environments** for those.

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
updated on its own host using its installation method. To let a standalone
`t3 update` download an archive, configure your organization's CLI archive
mirror with `T3CODE_RELEASE_BASE_URL` on that host.

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
A thread that finished its turn to wait on a subagent, a background task, a Claude
monitor or `sleep` timer, or a command or other monitor the agent said it was waiting on is woken and told that this work
stopped. Other background shells and monitors, such as a dev server and its
watchdog, do not wake it; the thread learns about them with your next message.
A thread is not resumed while it waits for your approval, answer, or secret, or
while it is archived, snoozed, or settled. After three consecutive crash recoveries
of an unfinished turn, the thread waits for your next message, even when crashes
are more than five minutes apart. A completed turn or a planned shutdown resets
that limit.

Each server checks npm/Homebrew/pnpm using its own local registry and proxy settings.

## Update providers

Open **Settings → Providers** and click **Update now** on individual providers or **Update all** across connected environments. Running chats keep using their current CLI until they end; new sessions and model catalogs refresh automatically. (Provider update checks in **Settings → Maintenance** must be enabled to fetch model catalog updates.)

## Mobile updates

- Update connected environments and providers from **Settings → Environments** on mobile.
- Update the mobile app via the App Store or Google Play (background over-the-air updates apply on next app switch and preserve drafts/queued messages).

## Troubleshooting

- **Version mismatch**: Update whichever side (app or server) the connection notice names.
- **Failed update**: Retry once; confirm you updated the host machine (not just the client) and that only one server owns the T3 home directory.
- **macOS Alpha → Beta**: Open `/Applications/T3 Code (Beta).app` manually and re-pin it to the Dock.
- **Desktop won't start**: Use the recovery window's **Update** button, install the linked last-working version, or **Copy details** for a bug report.
