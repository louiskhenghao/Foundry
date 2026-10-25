# ADR-0079: Goal templates — a pattern the New goal form starts from, as Markdown files Foundry ships and the person keeps

**Status:** accepted · 2026-10-25 · builds on [ADR-0054](0054-schedules.md), [ADR-0066](0066-themes.md) and [ADR-0073](0073-a-conversation-about-a-goal.md); amends [ADR-0030](0030-transfer-merges-goals-as-history.md)

## Context

The New goal form asks for a description, and a person making their first video goal, their first figure or their first
PRD does not know what a good one says: which facts the Clarifier will need, which decisions are worth stating up front,
which settings (the kind, the engine, Simple or Expert, the budget) suit the work. Every kind of goal has a shape the
Brief wants, and the person learned it by writing bad descriptions first. They asked for templates: a chosen pattern
whose blanks they fill, with a feel of a marketplace — Foundry's own, and their own kept for later — and a way to hand
the AI their rough notes and have it write the description. Thirteen decisions of a design interview settled it; the
ones that shape the system are here.

What already existed shaped the answer. A Schedule (ADR-0054) keeps the form's body as a *recipe* to submit again; a
template is the same body with blanks and without what binds to a computer. Themes (ADR-0066) are checked data files in
the data folder, copied from read-only built-ins, edited in any editor, exported and imported; the built-in ones ship
with Foundry. Roles are versioned Markdown in the checkout. The engine already runs one-turn structured calls on the
housekeeping model (the nature classifier) and read-only sessions on the Explainer's row (ADR-0073), and records usage
without a goal (the rate-limit probe).

## Decision

- **A Template is a Markdown file**: a frontmatter (name, summary, nature, the settings it brings, what its inputs
  say) over the goal description. **The body's `{{placeholders}}` are the inputs**, in the order the body first names
  them; the frontmatter only refines them (label, help, text / paragraph / choice with options, default, required). An
  input the frontmatter declares and the body never names is a warning. A placeholder with nothing said is a required
  one-line input named after its key. Rendering fills the placeholders, uses defaults, drops the line of an empty
  optional input, and names the required inputs still empty; a goal is not made while there are any.
- **The frontmatter is a small YAML of Foundry's own** — maps, lists, scalars, `|`/`>` blocks and `[a, b]` lists, read
  and written by one module in the core — rather than a YAML dependency: the shape is fixed, a dependency would reach
  the browser bundle and the credits, and a hand-written file deserves an error that names its line.
- **A template brings only the settings about the work**: the nature (with a video goal's engine and a figure's style),
  the view, the workflow (pace, discipline, Ponytail, suite), the budget preset (and limits when custom), the interview
  depth and the skip-Clarify checks. Never the coding agent, its models or effort, the delivery, the output folder, the
  repository, companions, attachments, references or an issue: those belong to a computer and its accounts, and a
  template travels. A video engine or figure style is dropped, and said so, while its Beta is off; a figure style not
  installed for the coding agent stays chosen, and the form says what the goal would draw in instead and where to
  install it. A template that names no budget leaves the form's (Auto); from the CLI it is Auto too. What a template
  does not name, the form keeps as the person left it.
- **Two sources and no remote.** Foundry's own templates are `templates/<id>.md` and `templates/<id>.zh.md` in its
  checkout, several per nature — from a bug fix to a 3D product showcase site, a SaaS dashboard, an AI assistant or a
  circuit-board enclosure — each in English and 中文 with the same inputs and settings (a test keeps the pairs honest, and
  every input carries an example for the preview); they update with Foundry and are read-only in the UI — a copy is the
  person's. The person's own are files of
  the same shape in `templates/` of the data folder, listed with every file that cannot be used and why, copied,
  renamed, exported, imported, deleted, opened in an editor, as themes are. The gallery, by kind with a search, is the
  marketplace; nothing is fetched from anywhere.
- **The form writes the description from the inputs until the person edits the words**; then the inputs stop, and one
  link writes it from them again. Choosing a template over a description the person wrote asks first. A chip names the
  template behind the form; its × forgets the template and keeps the words and settings. The language of the templates
  (EN / 中文) is this browser's choice, as the theme is.
- **The AI draft is one session without a goal.** Fast by default: a single turn on the housekeeping model, no tools,
  the notes alone — it fills the chosen template's inputs, or writes a description shaped like the nature's built-in
  template (deciding the nature when the form had not), keeping to the notes and leaving empty what they do not say.
  With *Also read the repository* ticked, a few read-only turns in the person's checkout on the Explainer's row (the
  read-only shell hook of ADR-0073, no worktree: nothing is written). It runs in the background and is polled, can be
  stopped, and its usage is a `template` session in the ledger with no goal and no budget. What it wrote is shown first
  and taken or left; it never writes into the form on its own.
- **The pipeline does not change.** A template's body may close with what is already decided; the Clarifier reads it as
  it reads any description, and a template that wants fewer questions sets the interview depth. No settled-decisions
  field is added to a goal's creation.
- **The goal records its template** (`template: { id, name }`, null on goals from before and on goals written from
  scratch), and its page names it. The CLI makes a goal from a template with `--template` and `--set key=value`, the
  server rendering the description and applying the template's settings where no flag spoke; the form sends the words
  it already rendered and the template's reference.
- **Templates & themes travel in a Transfer file** (amending ADR-0030) under a category of their own: the person's
  files as written. A file with the category is written in a second format version, which an older Foundry refuses; a
  file without it stays the first, so nothing changes for a Transfer of settings and goals. On arrival a file already
  there as written is skipped, and a file that clashes with one there or with a built-in's id gets a numbered id, every
  language of a template with it.

## Consequences

- A new kind of goal needs a few templates in two languages before it is complete, and a change to a built-in template
  changes what a person's next goal of that kind says; the built-in set is reviewed like the role prompts.
- The settings a template may carry are the New goal form's: a setting the form does not show (the self-check, the
  milestone pause) is not a template's, so what the person sees on the form is what the template did.
- The housekeeping model writes the fast draft and the Explainer's row the repository-aware one; a person who tuned
  those rows for other work tunes the draft with them.
- The templates folder is the person's: a file edited by hand with a mistake is listed with its line and the form goes
  on without it; the folder is copied whole when a Transfer is not at hand.
