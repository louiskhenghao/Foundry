# Figure goals (beta)

A **figure** is an interactive isometric drawing of an everyday object or machine, as one web page: a kettle you switch on and watch boil, a vending machine that takes a coin and drops a can, a toaster whose lever you press, with a switch that shows the mechanism working inside. You describe the object in a sentence; a goal of kind **Figures** draws it. The page is yours: it opens in any browser, works on a phone, and carries no credit line.

Figures are a **beta** feature: off until you switch it on, and marked **Beta** where it appears.

Two styles are available, from two skills by April Zhu that Foundry ships with:

| Style | What it looks like | Suits | Takes |
|---|---|---|---|
| **Colorfigures** | Colourful, hand-inked isometric figures on warm paper. Drag to turn the object all the way round, press buttons that do what the real ones do, switch on **See-through** to watch the mechanism with labelled parts. | Everyday machines and devices with pressable parts: appliances, vending and arcade machines, toys, kiosks. Not soft or organic things. | 15–30 minutes and a few hundred thousand tokens a figure: the skill researches how the real object works, draws it, checks its own shots from every side and builds the page. |
| **iso-glow** | Dark hairline drawings where only what is live glows in one accent colour: a pressed key, a lit window, a wire carrying signal. A light theme, a 3D mode, and a solid, lit style for product illustration. | Desk objects, devices, buildings and cityscapes, diagrams whose signals light up. | About a minute a figure. |

## Switching it on

1. **Settings → Beta → Figure goals**: on. **Figures** appears among the kinds of goal on the New goal form, and **Figure skills** under Settings → Skills.
2. **Settings → Skills → Figure skills**: pick **Colorfigures** or **iso-glow** as the default style and press **Install**. Both skills are bundled with Foundry, so installing copies them to your coding agent's skills folder; nothing is downloaded. The pack works like the Design, Image and Video packs, with one difference: a goal may pick the other installed style (see below).
3. The tools, which the Setup page's doctor lists while the pack is chosen:
   - **Chromium** (Settings → Preview & self-check → **Install Chromium**): Foundry opens every finished figure page in it to make sure the page runs. Without it every figure task fails its check.
   - **python3**: Colorfigures builds its one-file page with it; iso-glow can do without. The Docker image has it.
   - **A Chrome on this computer** (Colorfigures only): the skill checks its own drawing from every side in headless Chrome. Without one it skips those shots and says so; Foundry's own check still runs. The Docker image provides one.

No image model and no API key are involved: the whole cost is the worker's tokens and time, like a code goal's. A figure task's session may run 45 minutes before Foundry cuts and resumes it, whatever the attempt timeout under Settings → Models & limits says: Colorfigures draws in a few long turns.

## Asking for a figure

On the New goal form pick **Figures**. Describe the object and what it should do, as you would to a person: *a gumball machine where I can put in a coin and turn the crank*; *a kettle that boils and clicks off by itself — show how it knows when to stop*. One figure per goal is the easy case; several figures become several tasks.

A **Style** row appears under the kinds: **Default** (the Figure skills setting), **Colorfigures** or **iso-glow**. With Default, Foundry may still pick the other installed style when your words clearly ask for its look: *dark*, *glowing*, *neon*, *line art*, *a skyline* lean towards iso-glow; *colourful*, *hand-drawn*, *a cutaway* towards Colorfigures. A style that is not installed for your coding agent is greyed out.

Figures is a media kind of goal: the form switches to **Simple** and ticks **Fast mode**, and an optional **Output folder** appears, where the finished pages are copied when the goal is done. The Brief then settles, before anything is drawn, what the figure must show: how the real object works step by step, what each button does, the colour, whether an inside view is wanted, the page's file name. You approve it as any Brief; from the command line it is `foundry goal new "…" --repo <path> --nature figure`, with `--figure-pack iso-glow` for the other style.

Colorfigures' page carries no footer, and its labels are in plain capitals, as the skill draws them. Chinese and other languages are fine in your description; ask in the goal if you want the button labels in a particular language.

## What you get

Each figure is one `.html` file under `artifacts/` in the progress folder, copied to the Output folder when the goal finishes, exactly as for [image and video goals](./getting-the-result.md#media-and-cad-goals-and-the-output-folder). The branch records a manifest for it: what the figure shows and what each button does.

When a task lands, Foundry itself opens the page in a headless browser: a page that throws, logs an error or draws nothing fails the task, which goes round again. The task's drawer shows the screenshots Foundry took — the closed object, and a Colorfigures page's see-through — and lists the page under **Files**. Clicking it opens the page in the preview, running: drag it, press its buttons. **Source** shows the file; **Open in a new tab** opens it on its own. The page runs in a sandbox with no access to Foundry, so a figure can never read your session or call Foundry's API.

An iso-glow page loads a web font when it is opened, and its 3D mode loads three.js from a CDN; a Colorfigures page loads nothing. Outside Foundry, double-click the file: it is a plain web page.

## Changing a figure

Once the goal is done, ask for the change as a follow-up: **Continue with a follow-up…** on the goal page, with the change in words (*make the door open further*, *add a coin return*). The new goal starts from the finished one, so the worker finds the page and its source where it left them.

## Credits

Colorfigures and iso-glow are by [April Zhu](https://april-zhu.com), MIT licensed; Foundry keeps a snapshot of each as its author publishes it (`catalog/bundled/`), unchanged, and refreshes them with its releases. Colorfigures builds on ISO-GLOW, which builds on iso-figure by Tolga Cohce (MIT). See the Open source credits page under Settings → About & updates.
