# ADR-0106: Before 3.0, a checkout or a container switches instead of updating

**Status:** accepted · 2026-11-16 · builds on ADR-0104 and ADR-0105 · amends ADR-0010

## Context

From 3.0 Foundry ships only as the macOS app and the Linux binary (ADR-0104, ADR-0105): no Docker image, no source
install. Everyone who runs a checkout or the container today must change how Foundry is installed to keep getting
releases. An update that silently changed that would surprise them; one that never came would strand them on the last
2.x. The person who owns the project asked for a dialog that says what happens before anything does, and a CLI that says
the same. The last 2.x is the release that carries it: it is the last image, and the last version a checkout pulls.

## Decision

- **A new major is a switch for a checkout or a container.** When the newest stable release's major is higher than the
  running one's and the deployment mode is *local* or *docker*, the updater's capability carries a `switch`: the
  version, what this computer switches to (the app on macOS, the binary elsewhere), the data folder in use, where the
  new install keeps it, the port, and the switch's log (`~/.foundry/switch.log`). The app and the binary update to it as
  to any release.
- **The risk dialog.** The update dialog then shows *Switch to Foundry 3.0*: what switching does (installs the new
  Foundry; stops this one; copies the data folder, the original staying as the backup; starts the new one on the same
  port, where the page reconnects; repositories and progress folders untouched), the risks (not notarized, disk and
  time for the copy, running goals paused first, where the log is), and the way back (the checkout or the volumes stay;
  quit the new Foundry and start the old one). A checkout switches on a ticked *I understand* box; the server refuses
  an apply without it (422). A container gets the steps to run on its host and no button: nothing in a container can
  install there.
- **The switch hands over to the release's own installer.** The running Foundry drains as for any update, downloads the
  release file for this computer and checks it against `SHA256SUMS`, unpacks it in a temporary folder, and starts the
  `install.sh` the release carries, detached: `--mode app|binary --from-file <the file> --migrate-from <the checkout>
  --migrate-data <its data folder> --migrate-stop <its pid> --port <its port>`. The installer places the new install,
  then `foundry migrate` stops the checkout's service (launchd or systemd, only one that runs this checkout) and the
  Foundry that asked, waits until no process has the database open, copies the data folder with ADR-0082's
  copy-and-rewrite and keeps the port in `~/.foundry/config.json`; the installer then starts the new install without
  opening another page. The update's record is written before the copy, so the new install's history has it.
- **Failing safe.** An installer that ends before it stopped the old Foundry gave up: the drain ends, the old Foundry
  carries on, and a failed record says where the log is. A copy that fails after the stop brings the old service back
  (its launchd agent or systemd unit is kept until the copy is made); a Foundry started by hand is said how to start
  again. Nothing deletes the checkout, its data or the volumes.
- **The CLI says the same.** `foundry update` on a source install prints the notice and asks; yes runs the same switch
  through the installer. On a Docker install it prints the notice and where the steps are.
- **`foundry repath <from> <to>`** rewrites a path in a stopped install's history, so a container's `/app/data` and
  `/repos` become the folders they are on the host; `foundry migrate --data` names a data folder that was not the
  checkout's own.

## Consequences

- The last 2.x is the only release with this dialog; 3.0 removes the image and the source mode (the next ADR), and a
  checkout or a container that skipped the last 2.x reaches it before 3.0.
- A switch needs as much free disk as the data folder takes; the folder test of ADR-0082 refuses a target without room.
- The installer that switches is the new release's, not the old one's: what 3.0 knows about installing is what runs.
