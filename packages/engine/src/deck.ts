/**
 * Deck goals (ADR-0084): slide decks as native, editable PPTX files — a pitch, a lecture, a report, a document turned
 * into slides — made by the Deck pack's skill (ppt-master) in a Python environment Foundry keeps, with the Brief standing
 * in for the skill's two confirmation stages. What the Clarifier, the planner, the worker and the reviewers are told
 * lives here; the check that opens each deck is checks/deck.ts.
 */
import type { DeckPack } from '@foundry/core';

/** the deck skill as a goal sees it: the pack Settings names, whether it is installed for the goal's coding agent, where its Python environment and its folder are, and whether an image key is set */
export interface DeckInfo {
  pack: DeckPack;
  installed: boolean;
  /** the skill's folder as installed for the goal's coding agent; null when not installed */
  skillDir: string | null;
  /** the Python environment made for the skill (its scripts' python3); null when it was not made */
  venv: string | null;
  /** an image-generation key reaches sessions (OpenAI or Gemini): the deck may carry AI-generated pictures */
  images: boolean;
}

/** where a deck and its project folder go under artifacts/ */
export const DECKS_DIR = 'artifacts/decks';

/** the deck skill is there to make decks with: the pack names it and it is installed */
export const deckSkillOf = (info: DeckInfo | null): boolean => !!info && info.pack !== 'none' && info.installed;

const SKILL_LOOK =
  "ppt-master (Hugo He): natively editable PPTX decks from a topic or from documents (PDF, DOCX, Markdown, HTML, spreadsheets) — real DrawingML shapes, text boxes, charts and tables, transitions and animations, speaker notes — designed page by page as SVG under its own design spec and compiled by its scripts. It plans the deck (audience, intent, core message, page roster) before drawing, and its default route keeps a design spec the work resumes from.";

/** what the Clarifier is told about a deck goal: the nature's rules and the skill that makes it */
export function deckClarifySection(info: DeckInfo | null): string {
  const skill = deckSkillOf(info)
    ? `The deck skill in use is ${SKILL_LOOK}${info?.venv ? '' : ' Its Python environment is not made yet (Settings → Skills → Deck skills → Install again, with uv on PATH): the worker will say so and do what it can.'}`
    : "No deck skill is installed for this goal's coding agent (Settings → Skills → Deck skills): the worker makes the PPTX by hand, without one (python-pptx or a plain OOXML package), in the same shape.";
  const images = info?.images
    ? 'An image-generation key is set: ask whether the deck should carry AI-generated pictures (default: no — the skill\'s own icons, shapes, charts and tables), and which slides.'
    : 'No image-generation key is set (Settings → Tools & keys): the deck carries no AI-generated pictures; the skill\'s own icons, shapes, charts and tables, and the pictures the person attached.';
  return `# Nature: deck
This goal produces slide decks, not software: one native PPTX file per deck, made by a deck skill the worker invokes. Set \`nature: "deck"\` and plan one task per deck (scenario \`deck\`) — a deck is one task from plan to export, never split into slides; Areas are the decks, or their audiences.
${skill}
Settle in the Brief, before anything is made, for each deck: who it is for and the occasion (a talk someone presents, a document read alone, a lecture, a pitch), its purpose and the one message it must land, the page count (a range), the canvas (16:9 unless the person says 4:3 or A4), the language, the sources (which attachments it draws on — a document turned into slides keeps its facts and order — or the topic alone, with the worker's research), whether it carries speaker notes (default: yes), transitions or animations (default: none beyond a plain fade), and the deck's name (its file). ${images} Output 2–4 \`styleOptions\` as for an image goal (a real palette, 1–3 typefaces, keywords, the feel): the chosen direction becomes the deck's visual style. Ask only what a wrong guess would spoil; the rest are assumptions the person can change.
Conventions every deck task's spec MUST state verbatim:
- the finished deck is an Artifact at \`${DECKS_DIR}/<name>.pptx\` (the engine keeps artifacts/ out of git; it is delivered to the Output Folder), named in \`delivers\`; the skill's project folder — its design spec, page SVGs and per-slide previews — lives beside it at \`${DECKS_DIR}/<name>/\`
- the task also writes its manifest \`docs/artifacts/<task-slug>.md\` (committed): the deck's path, the slide count, one line per slide, the design decisions, the sources used
- the skill's two confirmation stages are answered by the Brief: the worker decides them from it and never waits for a person
Acceptance: Foundry itself opens every delivered deck, counts its slides, refuses an empty one, runs the skill's own delivery check and renders the per-slide previews for the person — plan no check for that. Add a reviewer check only for what the previews can be judged on (the sections the Brief names are there, the message lands, the slide count is in range); command checks only for objective facts (the file exists). Never ask about tech stacks and never propose build/test/lint checks. Narration audio and video are not part of a deck goal unless the person asks for them.`;
}

/** the planner's rules for a deck goal */
export const DECK_PLAN = `# Decks
One task per deck (scenario \`deck\`), from plan to export in one task — never one task per slide, and no separate design or review task: the skill plans, designs and compiles in one run that Foundry resumes if a session is cut. A short research task before a deck only when the Brief says the facts are missing and no source was attached. Each task's spec states, verbatim, the deck's name and path (\`${DECKS_DIR}/<name>.pptx\`, named in \`delivers\`), its project folder (\`${DECKS_DIR}/<name>/\`), the manifest \`docs/artifacts/<task-slug>.md\`, and the Brief's answers for that deck: the audience and occasion, the purpose and core message, the page range, the canvas, the language, the sources, the chosen style direction (palette, typefaces, keywords), speaker notes, animations, AI pictures. Independent decks are independent tasks. Never build/test/lint checks; Foundry opens each deck itself when the task lands, so plan no check for the file's contents. A command check that reads the deck MUST fail when it is missing: \`test -f ${DECKS_DIR}/<name>.pptx\`, never a bare command on the folder.`;

/** the worker's conventions on a deck task: the skill's folder and its Python environment are named, so the commands the skill gives resolve */
export function deckWorkerConventions(info: Pick<DeckInfo, 'skillDir' | 'venv' | 'images'> | null): string {
  const skillDir = info?.skillDir ?? null;
  const venv = info?.venv ?? null;
  return `# Deck conventions
- Invoke the deck skill the Workflow skills section mandates and follow its default route (Generate PPTX — ordinary Default), not the Quick profile: the default route keeps \`design_spec.md\` and \`spec_lock.md\`, which your work resumes from if this session is cut, and leaves one preview per slide. ${skillDir ? `Its folder — the skill's \`SKILL_DIR\` — is \`${skillDir}\`; expand every \`\${SKILL_DIR}\` in its commands to that path.` : 'Its folder is where your coding agent keeps skills; expand every `${SKILL_DIR}` in its commands to that path.'}
- The person has explicitly delegated both confirmation stages to the Brief: make the Stage-1 decision (the communication contract, free design unless the Brief names a template) and derive Stage 2 from the Brief's answers and the task spec, install nothing interactive, and put the one complete summary the skill asks for in your result. Never launch the skill's confirmation page or server, never wait for a submission, never ask.
- \`python3\` on your PATH is ${venv ? `the environment Foundry made for the skill (\`${venv}\`), with its packages installed` : "the system's: the skill's Python environment was not made (uv was missing when the pack was installed); run what works without its packages and say what you could not run"}; never install packages anywhere.
- The project: \`python3 \${SKILL_DIR}/scripts/project_manager.py init <name> --dir ${DECKS_DIR}\`, so the project folder is \`${DECKS_DIR}/<name>/\` in this workspace (artifacts/ never reaches git). Sources are the goal's attachments (their paths are in the attachments section): convert each with \`source_to_md.py\` and \`import-sources\` as the route says; with no attachment, the Brief's text and your research are the content.
- ${info?.images ? 'AI-generated pictures only when the Brief chose them, for the slides it names: an OpenAI or Gemini key is in your environment; export `IMAGE_BACKEND` accordingly before the image commands.' : 'No AI-generated pictures: no image key reaches this session. Use the skill\'s icons, shapes, charts and tables, and the pictures attached to the goal.'}
- Speaker notes, animations and the canvas as the Brief says; narration audio and video never, unless the task spec asks for them.
- Before export run \`finalize_svg.py <project>\` so \`svg_final/\` holds one self-contained preview per slide — Foundry renders those for the person — then export with \`svg_to_pptx.py\` as the route says and read its postflight receipt. Copy the exported file to \`${DECKS_DIR}/<name>.pptx\`, the path the task's \`delivers\` names; the timestamped export stays in the project folder.
- Keep the manifest named in your task spec (\`docs/artifacts/…\`) up to date: the deck's path, the slide count, one line per slide, the design decisions, the sources used. Commit nothing from the project folder.
- Do not open a browser, a preview server or PowerPoint for the person: Foundry opens the deck itself when you finish, counts the slides, runs the skill's delivery check and renders the previews.
- Codebase conventions and test suites do not apply here.`;
}

/** the task reviewer's note on a deck task */
export const DECK_REVIEW_TASK = `# Deck review
The deliverable is a PPTX under \`artifacts/\`, which is NOT in the diff (the folder is kept out of git); the task's manifest (\`docs/artifacts/…\` in the diff) describes it. Foundry has opened the deck already: its deck check says how many slides it has, whether the skill's delivery check passed, and names the PNG it rendered of each slide's preview. Read the manifest, open the previews with the Read tool (it renders images) and judge against the task and rubric: a title, the sections the spec names in order, the core message landed, text that fits its boxes and reads at a glance, the slide count within the range. A missing deck, a failed deck check, a slide count outside the range, or a section the spec names that is not there is a blocker; taste stays with the person.`;

/** the goal reviewer's note on a deck goal */
export const DECK_REVIEW_GOAL = `# Deck review
This goal's deliverables are PPTX files under \`artifacts/\` — NOT in the diff (kept out of git); the committed \`docs/artifacts/\` manifests describe them, and Foundry's deck checks opened each deck (their results are among the checks). Verify every manifest entry exists on disk, open the previews the deck checks name with the Read tool, and check the deck against the Brief: the sections, the message, the slide count. A deck that failed its deck check, is missing, or lacks a section the Brief names is a BLOCKER.`;
