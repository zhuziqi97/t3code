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
