# Editor

*Beta: switch it on under [Settings → Beta](./settings.md#beta).*

A video goal's result is a film, and a film is rarely right the first time. The **Editor** opens it from the goal page: for a HyperFrames goal, HyperFrames' own browser editor on the goal's project, where you cut, move, retime and restyle the film yourself; for a [motion-studio](./motion-studio.md) film, a page that scrubs through it. Nothing you do there costs the goal anything.

## HyperFrames goals

A HyperFrames goal keeps its film as a project folder in the progress folder (the folder `hyperframes init` made, with its `hyperframes.json`). The **Workspace & preview** card lists one row per project, **Editor · <project>**, beside the repository's own apps, while the goal runs and after it finished:

- **Start** runs HyperFrames' browser editor on a preview port, in the project's folder, with the release the project's own scripts pin (`npx hyperframes@<version> preview`), or Foundry's when they pin none. The first start fetches that release, which takes a moment. **Open** opens it in a new tab; **Stop** stops it. The ⚙ **Open** menu at the top of the goal page has the same under **Editor**: one press starts it if need be and opens it.
- Inside: the timeline (move, trim, split, snap to beats), the inspector for text, layout, style, media and motion, the layers, the captions word by word, the assets, **Lint** and **Export**. Every change saves straight to the project's files in the progress folder; HyperFrames keeps backups under `.hyperframes/backup/` in the project.
- **While the goal runs**, the row says so: the coding agents work in the same folder, so what you save goes into their next commit, or may be overwritten by it. Edits made after the goal finished are yours alone until you **Re-render** them.
- Like any preview, the editor is reachable from your phone over your tailnet when you use Tailscale (see [Preview](./while-it-runs.md#preview)). On this computer it listens on localhost only; in Docker, on the published preview range.
- **Export** inside the editor writes to the project's `renders/` folder, which Foundry keeps out of git and does not deliver. The result of the goal comes from **Re-render** below.

The editor is the person's: a milestone, the self-check and an integration never start it, and a task landing does not restart it. It stops when you press **Stop**, when it sat idle for the preview's idle time, or when Foundry stops.

## Re-render

Once a HyperFrames goal has finished (done, over-delivered or failed), the **Re-render** card on its page renders the films again after your edits, with no session:

1. The result as it stands is kept under `artifacts/.history/<n>/` in the progress folder, as before an [adjustment](./getting-the-result.md#adjusting-the-result); the edits share the adjustments' numbering.
2. Every project is rendered with `hyperframes render --quality delivery` to `artifacts/video/<project>/final.mp4`, and the file is checked with ffprobe. **▸ output** shows the render as it goes.
3. Your edits land on the goal branch as a commit of their own, *chore(video): edits in the editor (edit n)*, so a branch already pushed is never rewritten.
4. The output folder gets the new files, and a branch already pushed or a pull request already open gets the new commit — nothing new to choose.

The card lists each edit with the version kept before it under **Before it**. A project whose render failed says so on the card and keeps its earlier file; the others still land. Re-render needs what HyperFrames needs: Node.js 22 or newer, FFmpeg, and a Chrome HyperFrames downloads by itself on the first render.

Not now: a goal still at work (wait for it to finish), a goal whose work was merged or whose progress folder was cleaned up (start a [follow-up](./getting-the-result.md#continue-with-a-follow-up)), a Delegated goal, an imported goal held as history, or a goal whose delivery is under way.

## Motion-studio films

A [motion-studio](./motion-studio.md) film is a function of time rather than an edited timeline, so there is nothing to drag: the **Workspace & preview** card lists one row per film under `motion/<slug>/`, and **Open** shows a page that scrubs through it — a format menu, **Play**, a slider, and the keys (space plays, ← → step one frame, shift for ten, Home and End). The film runs in a sandbox, the way a figure's page does. The page only looks: to change the film, [adjust the result](./getting-the-result.md#adjusting-the-result).
