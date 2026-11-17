# ADR-0107: A move from an earlier install takes one click

**Status:** accepted · 2026-11-17 · builds on ADR-0082, ADR-0105 and ADR-0106

## Context

ADR-0105 gave a source install a way into the app or the binary: `foundry migrate`, offered by the installer. ADR-0106
gave a checkout one more, the switch before 3.0. Before 3.0 removes the source and Docker modes, the person who owns
the project asked for the move to be one a person cannot get wrong: no commands to type, nothing to lose. Running
2.36.0 on a real Mac found how far it was from that:

- **The app's first start blocked the move.** The app makes its data folder when it first opens, and `foundry migrate`
  then found "a data folder already there" and moved nothing. A person who downloads the app and opens it, as the
  install guide says, could no longer move their goals.
- **The move needed a terminal.** The app never offered it. `foundry migrate` had to be run by the app's binary path,
  because the `foundry` command on that computer was still the source installer's script.
- **It moved what the installer had recorded, not what ran.** The installer remembered a checkout from an earlier
  install that had no goals. The Foundry with every goal was a checkout started by hand, which nothing recorded.
- **A Docker install had six commands to run**, one of them guessing where the repositories were.
- **A move carried less than it looked.** Settings set in a checkout's `.env`, a launchd agent or a compose `.env`
  stayed behind. The goals' git worktrees still pointed at the folder they had left. A goal at work was cut off
  mid-step. The new install served on another port than the bookmarks knew.

## Decision

- **One move, four ways in.** The page, `foundry migrate`, the installer and the switch all run the same move
  (`packages/engine/src/move/`). The page and the CLI hand it to the running app when there is one; the installer runs
  it before the new install starts.
- **Earlier installs are found, not named.** The move looks in the places an install can be; a process counts only when
  bun itself runs the checkout's entry point (a shell that mentions it does not). It reads the installer's
  record (`~/.config/foundry/install.env`) and the checkout's service, a launchd agent or systemd unit. It also lists
  the Foundry processes running from a checkout, with the data folder each one holds open. For Docker it checks the
  containers made from the Foundry image, never one only named like it. Each found install says where it is, its
  version, whether it runs, its goals and its last activity. A folder with a `MOVED.md` has moved already and is
  left out. An install with no goals is listed but never offered.
- **The page offers it when there is something to move.** An app or binary install with no goals of its own shows
  *Bring your goals over* on the Goals page, with the install it found, its goals and one button. Settings keeps the
  same move under *Engine (install)*, for a person who already has goals here: that move sets this install's folder
  aside as a backup, never merges, and says so before it starts. A checkout never offers a move.
- **What a move does, in order.**
  1. **Pause.** Goals at work in the old Foundry are paused gently through its API, and the move waits until nothing
     runs there. *Move now* skips the wait: the steps in flight start again here.
  2. **Stop.** The old Foundry stops the way it runs. A launchd agent is booted out and a systemd unit is stopped, but
     their files stay until the copy is made. A process started by hand gets SIGTERM. A container's restart policy
     becomes `no` before `docker stop`, so neither Docker nor its watchtower brings it back. The move waits until
     nothing has its `engine.db` open.
  3. **Copy.** Each data folder is copied into a staging folder beside this install's own: `cp -c` (an APFS clone,
     instant and free of disk space) or `cp --reflink=auto`, a plain copy where neither works, `docker cp` from a
     container. The old Foundry's `engine.pid` is not copied.
  4. **Rewrite.** ADR-0082's rewrite makes the paths the folder wrote about itself point at where it will live, not at
     the staging folder. A container's paths map back to the computer's: `/app/data` to the data folder, each bind
     mount to its source. Each goal worktree's `.git` gets the same mapping, and `git worktree repair` points its
     repository back at it.
  5. **Carry the settings.** What the old Foundry read from its environment (its `.env`, its service, a compose
     `.env`) is written into the copy's `settings.json`, for the settings the file does not hold yet. Paths that only
     meant something inside a container are left out, as are the port and the host.
  6. **Verify.** The copy passes `PRAGMA quick_check`, and it has as many goals and events as the folder it came from.
  7. **Swap.** This install's own folder is renamed aside as `<folder>.before-move-<time>`, and the staging folder takes
     its place, while this install's engine is stopped (the serve loop of ADR-0082 does it in the app).
  8. **Retire, once the copy runs here.** The first start on the copy does it; a move made with no engine running here
     (the CLI, the installer) does it at once. The copied folder gets a `MOVED.md` that says how to go back. The old service is turned off
     (`launchctl disable`, `systemctl --user disable`) with its file kept for the way back; a container keeps the
     restart policy `no` and stays, with its volumes, as the backup. The installer's record and the `foundry` command
     become this install's (`install.sh adopt`), while the record still names a source or Docker install.
  9. **Take over.** This install serves on the old one's port when it is free, so bookmarks and the CLI keep working.
     The job says where Foundry will answer before anything stops, and stays *restarting* for 1.5 s, so the page and
     `foundry migrate` follow it there even when their server stops answering first. The first start on the copy
     links each worktree to its repository again and resumes the goals the move paused; `moved-from.json` in the copy
     says where its goals came from.
- **An unattended move never chooses.** With more than one earlier install with goals, the installer and `--yes` move
  none of them and say how to choose: the page lists them, and `foundry migrate --from` names one.
- **A folder that moved is not opened again.** Its goals run in the copy now: a Foundry that finds a `MOVED.md` in its
  data folder refuses it, so a checkout started again by habit cannot run the same goals beside the app (two
  deliveries, two watchers of each pull request, two readers of one bot). A release install whose chosen folder moved
  starts on its own folder with a notice. Going back means deleting that `MOVED.md`, which the note says.
- **A failed move puts everything back.** The old install is written down before anything is copied
  (`<folder>.moving.json`: how it ran, its folders, the goals paused there), and nothing about it but its stop changes
  until the copy runs here. A failure before the swap deletes the staging folders, starts the old Foundry again its own
  way and resumes the goals paused there; this install never changes. A copy that cannot boot is swapped back, and the
  old install started again from that record. A move cut off in between (the app quit, the computer off) is undone by
  the next start. No goal can be made here while a move runs, and one made anyway stops the move.
- **A folder chosen in Settings is opened, not copied.** When the app first starts and another Foundry holds the
  folder chosen in Settings, it starts on its default folder instead and offers the move. The move then stops the other
  Foundry and restarts this one on the chosen folder.
- **The switch keeps its flags.** `foundry migrate --from <checkout> --data <folder> --stop-pid <pid> --keep-port <port>`
  is what a 2.x switch asks of the 3.0 installer, and it runs the same move.
- **Docker's way to 3.0 is one command.** The switch shows a container `curl … | bash` to run on the computer Docker
  runs on, or the app to download: either finds the container and offers the move. An installer run with `--no-start`,
  as 2.36.0's six steps do, leaves a container to those steps.

## Consequences

- A person on a source or Docker install downloads the app, opens it and presses one button. Nothing about the old
  install is deleted: its folder (or its container and volumes) is the backup, and `MOVED.md` says how to go back.
- The move reads other processes (`ps`, `lsof`, `/proc`) and runs `docker`, `launchctl` and `systemctl`, and it acts
  only on the install the person chose.
- An APFS or reflink copy costs no disk space until either side changes. A plain copy needs room for the whole folder,
  and the move checks for it first.
- Going back after a repair: the old checkout's worktrees still work, and `git worktree repair` run in the old folder
  points the repositories back at it.
