# Deck goals (beta)

A **deck** is a slide presentation: a pitch to a room, a lecture, a quarterly review, a document turned into slides. You describe it in a few sentences, attach the documents it should draw on, and a goal of kind **Slides** makes it as a native **PPTX** file: real shapes and text boxes, charts and tables, speaker notes, editable in PowerPoint, Keynote or Google Slides. Foundry shows you every slide as it was made.

Decks are a **beta** feature: off until you switch it on, and marked **Beta** where it appears.

The making is done by one skill Foundry installs for you, **PPT Master** (ppt-master) by Hugo He. It plans the deck first — who it is for, what it must land, the page roster — then designs every page as a drawing and compiles the drawings into a PowerPoint file with its own scripts. Those scripts need Python with a set of packages, which Foundry installs into an environment of its own when you install the pack; nothing is added to your system's Python.

## Switching it on

1. **Settings → Beta → Deck goals**: on. **Slides** appears among the kinds of goal on the New goal form, and **Deck skills** under Settings → Skills.
2. **uv** must be on your computer: Foundry uses it to make the skill's Python environment, Python included. The Setup page's doctor says when it is missing; install it from [docs.astral.sh/uv](https://docs.astral.sh/uv/getting-started/installation/). The Docker image has it.
3. **Settings → Skills → Deck skills**: **PPT Master** is chosen already; press **Install**. Foundry clones the skill at one fixed release (it is large, about 80 MB), makes the Python environment under the data folder's `python/` and installs the skill's packages into it; the log scrolls under the card, and the whole step takes a few minutes the first time. A pack that reads **partial** was installed without uv: install uv and press **Install** again.
4. The tools, which the doctor lists while the pack is chosen: **uv**, the skill's **Python environment** (it checks the packages import), and **Chromium** (Settings → Preview & self-check → **Install Chromium**), which renders the previews of each slide; without it Foundry still counts the slides but shows no previews.

No API key is needed for a deck. If an image key is set under **Tools & keys** (OpenAI or Gemini), the Brief asks whether the deck should carry AI-generated pictures; without one the deck uses the skill's icons, shapes, charts and tables, and the pictures you attach.

A deck is a long task: the skill draws tens of pages. Its session may run 60 minutes before Foundry cuts and resumes it, whatever the attempt timeout under Settings → Models & limits says, and a resumed session picks up from the design spec the skill keeps.

## Asking for a deck

On the New goal form pick **Slides**. Say what the deck is for and who will see it, as you would to a colleague: *a 12-slide pitch of our product for seed investors, the ask is a second meeting*; *turn the attached Q3 review into slides for the leadership meeting, keep every number*; *a 45-minute onboarding session on our deployment pipeline for new backend engineers*. Attach the documents it should draw on with **Attach**: PDF, Word, Markdown, HTML and spreadsheets are read; the deck keeps their facts and their order. One deck per goal is the usual case; several decks become several tasks.

The four templates under **Slides** — **Pitch deck**, **Document to slides**, **Lecture or training deck** and **Status or review deck** — ask for the room, the points, the outcomes or the facts and fill in the rest.

Slides is a media kind of goal: the form switches to **Simple** and ticks **Fast mode**, and an optional **Output folder** appears (it receives the finished PPTX). The Brief then settles, before anything is made: who the deck is for and the occasion, its purpose and the one message it must land, the page count as a range, the canvas (16:9 unless you ask for 4:3 or A4), the language, the sources, speaker notes (yes by default), transitions or animations (none beyond a plain fade by default), AI pictures when a key is set (none by default), and the deck's name. It also proposes two to four **style directions** — a palette, typefaces, a feel — as an image goal's Brief does; the one you pick becomes the deck's look. You approve it as any Brief; from the command line it is `foundry goal new "…" --repo <path> --nature deck`.

The skill normally asks its user to confirm its plan on a page it serves, in two stages. In Foundry the Brief is that confirmation: the worker decides both stages from it and never waits for you.

## What you get

The deck is a file, not code: `artifacts/decks/<name>.pptx` in the progress folder, never added to git, copied to the **Output folder** when the goal is done (or left in the progress folder, under **Open ▾**, when you set none). Beside it, under `artifacts/decks/<name>/`, the skill leaves its project: the design spec, every page's drawing, the per-slide previews and its timestamped exports. The branch records a manifest: the deck's path, the slide count, one line per slide, the design decisions and the sources used.

When the task lands, Foundry itself opens the deck: a file that is not a PowerPoint package, a deck with no slides, or a slide with neither text nor a picture fails the task, which goes round again; so does a deck the skill's own delivery check refuses. Foundry then renders the skill's previews of every slide. The **Have a look** card and the task's drawer show them, one thumbnail per slide, and the card links the PPTX itself (it downloads; open it in PowerPoint or Keynote). The reviewers look at the same previews.

## Changing a deck

Once the goal is done, small changes go through **Adjust the result** on the goal page (beta, see [Adjusting the result](./getting-the-result.md#adjusting-the-result)): *drop the market slide*, *make the ask the last slide*, *the chart on slide 6 should show percentages*. The session that made the deck picks up its project where it left off, changes the pages, exports again and Foundry opens the new deck; the earlier file is kept under **Before it**. For a different deck, or once the goal's work was merged, ask as a follow-up: **Continue with a follow-up…**.

## Credits

PPT Master is by [Hugo He](https://github.com/hugohe3/ppt-master), MIT licensed; Foundry installs it from its repository at one fixed release and moves that release on with its own releases. The Python packages it needs are installed by your own install, into your data folder, under their own licenses (PyMuPDF among them is AGPL). See the Open source credits page under Settings → About & updates.
