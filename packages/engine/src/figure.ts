/**
 * Figure goals (ADR-0076): interactive isometric figures of everyday objects and machines, one self-contained HTML page
 * each, drawn by a skill of the Figure pack — Colorfigures (hand-inked colour, working buttons, a see-through) or
 * iso-glow (dark hairline drawings where whatever is live glows). What the Clarifier, the planner, the worker and the
 * reviewers are told about them lives here; the render check that opens each page is checks/figure.ts.
 */
import type { FigurePack } from '@foundry/core';

/** the styles the pack offers: the pack minus `none` */
export type FigureStyle = Exclude<FigurePack, 'none'>;
export const FIGURE_STYLES: readonly FigureStyle[] = ['colorfigures', 'iso-glow'];
export const isFigureStyle = (v: unknown): v is FigureStyle => FIGURE_STYLES.includes(v as FigureStyle);

/**
 * How long a figure task's session may run before Foundry cuts and resumes it, whatever the attempt timeout in Settings:
 * Colorfigures draws in a few very long turns and takes 15–30 minutes a figure, so the default 20-minute cap cut the
 * first live run mid-turn (the resume kept the context, at the price of a replay).
 */
export const FIGURE_SESSION_MIN = 45;

/** the session cap for one attempt: the Settings cap, raised to FIGURE_SESSION_MIN for a figure task (ADR-0076) */
export function attemptTimeoutMs(config: { attemptTimeoutMs: number }, task: { scenario?: string }): number {
  return task.scenario === 'figure' ? Math.max(config.attemptTimeoutMs, FIGURE_SESSION_MIN * 60_000) : config.attemptTimeoutMs;
}

/** the figure skills as a goal sees them: the pack it follows (its own choice, else Settings') and which styles are installed for its coding agent */
export interface FigureInfo {
  pack: FigurePack;
  installed: FigureStyle[];
}

export const FIGURE_STYLE_INFO: Record<FigureStyle, { label: string; look: string; suits: string; cost: string; words: string }> = {
  colorfigures: {
    label: 'Colorfigures',
    look: 'colourful, hand-inked isometric figures on warm paper — real 3D bodies in flat light, mid and dark bands, a heavy ink silhouette, a blue cast shadow; the viewer drags to turn the object all the way round, presses buttons that do what the real ones do, and switches on See-through to watch the mechanism work inside with labelled parts',
    suits: 'everyday machines and devices with pressable parts (appliances, vending and arcade machines, toys, kiosks), "how does X work" and "what is inside X"; not soft or organic subjects',
    cost: 'slow and thorough: the skill researches how the real object is built, draws it, checks its own shots from every side in headless Chrome and builds the page with python3 — 15 to 30 minutes and a few hundred thousand tokens a figure',
    words: 'colourful, hand-drawn, inked, paper, cutaway or see-through of a machine, playable buttons',
  },
  'iso-glow': {
    label: 'iso-glow',
    look: 'monochrome hairline isometric drawings on a dark panel where only what is live glows in one accent colour — a pressed key, a lit window, a wire carrying signal; a light theme, a 3D mode (three.js: orbit, revolve) and a solid, lit Lumen style for product illustration',
    suits: 'desk objects, devices, buildings and cityscapes, diagrams whose signals light up',
    cost: 'quick: about a minute a figure; the skill finishes without opening a browser',
    words: 'dark, glowing, neon, line art, hairline, city, skyline, 3D, Lumen',
  },
};

/** the style a goal's figure tasks follow: its pack when that is an installed style, else the first installed one; null = none installed */
export function figureStyleOf(info: FigureInfo): FigureStyle | null {
  if (isFigureStyle(info.pack) && info.installed.includes(info.pack)) return info.pack;
  return info.installed[0] ?? null;
}

/** what the Clarifier is told about a figure goal: the nature's rules and which style the goal draws in */
export function figureClarifySection(info: FigureInfo | null): string {
  const style = info ? figureStyleOf(info) : null;
  const other = info && style ? info.installed.find((s) => s !== style) : undefined;
  const styles = !style
    ? "No figure skill is installed for this goal's coding agent (Settings → Skills → Figure skills): the worker draws the page by hand, without one. Leave `figurePack` out."
    : [
        `The figure skill in use is ${FIGURE_STYLE_INFO[style].label}: ${FIGURE_STYLE_INFO[style].look}. It suits ${FIGURE_STYLE_INFO[style].suits}; ${FIGURE_STYLE_INFO[style].cost}.`,
        other
          ? `${FIGURE_STYLE_INFO[other].label} is also installed (${FIGURE_STYLE_INFO[other].look}). Set \`figurePack\` to "${other}" only when the goal's words clearly ask for that look (${FIGURE_STYLE_INFO[other].words}); otherwise leave it out.`
          : 'It is the only style installed: leave `figurePack` out.',
      ].join(' ');
  return `# Nature: figure
This goal produces interactive isometric figures, not software: one self-contained HTML page per figure, drawn by a figure skill the worker invokes. Set \`nature: "figure"\` and plan one task per figure (scenario \`figure\`); Areas are the figures, or the subjects they illustrate.
${styles}
Settle in the Brief, before anything is drawn, what each figure must show: the real object and how it really works, step by step (what each button or control does and where every material goes), the 2–5 actions the viewer can take, the colour or palette, whether an inside (see-through) view is wanted, and the file name of its page. Ask only what a wrong guess would spoil; the rest are assumptions the person can change. Output an empty \`styleOptions\`: the skill's own look is the style, and the palette is a Brief question.
Conventions every figure task's spec MUST state verbatim:
- the finished page is committed in the repository, one self-contained file at \`figures/<name>.html\` (or where the repository already keeps such pages), and the task names that path in \`delivers\`; the figure's source — the un-built page with the engine or kit files it loads — is committed beside it under \`figures/<name>/\`, so a later goal can change the figure
- the worker's own shots and scratch files go under \`artifacts/\` (the engine keeps that folder out of git); nothing of the deliverable lives there
- the task also writes its manifest \`docs/artifacts/<task-slug>.md\` (committed): the page's path, what the figure shows, what each button does
- no footer, credit or "Made with" line on the page
Acceptance: Foundry itself opens every delivered page in a headless browser, fails the task on script errors or an empty page, and screenshots it for the person — plan no check for that. Add a reviewer check only for what a screenshot can be judged on (the right parts and controls are there); command checks only for objective facts (files exist). Never ask about tech stacks and never propose build/test/lint checks. No image-generation API or key is involved.`;
}

/** the planner's rules for a figure goal */
export const FIGURE_PLAN = `# Figures
One task per figure (scenario \`figure\`), in the order the person would want them; a short research task before a figure only when the Brief says the facts about the real object are missing. Each task's spec states, verbatim, the page's path in the repository (\`figures/<name>.html\` unless the repository keeps such pages elsewhere, named in \`delivers\`), the source folder beside it (\`figures/<name>/\`), the manifest \`docs/artifacts/<task-slug>.md\`, the no-footer rule, and the Brief's answers for that figure: how the object works, the actions, the colour, whether an inside view is wanted. Independent figures are independent tasks and run in parallel. Never build/test/lint checks; Foundry opens each page itself when the task lands, so plan no render check. A command check that reads the page (no footer, a label present) MUST fail when the page is missing: \`test -f figures/<name>.html && ! grep …\`, never a bare \`! grep\`.`;

/** the worker's conventions on a figure task */
export const FIGURE_WORKER_CONVENTIONS = `# Figure conventions
- Invoke the figure skill the Workflow skills section mandates and follow it: it owns the look, the drawing method and the build.
- The finished page is one self-contained .html committed in the repository at the path the task's \`delivers\` names (\`figures/<name>.html\` unless the repository keeps such pages elsewhere). Commit its source beside it, under \`figures/<name>/\`: the un-built page and the engine or kit files it loads (Colorfigures: figure.html and core.js; iso-glow: fig.js), so a later goal can change the figure. Your own shots and scratch files go under \`artifacts/\`, which never reaches git.
- No footer, credit or "Made with" line on the page: Colorfigures takes \`credit: false\` in \`mountFigure({...})\`; in iso-glow's template, delete the footer. Everything else about the look is the skill's.
- Labels and text as the skill says (plain capitals and digits); write the button labels in the goal's language only when the goal asks for it.
- Do not open a browser window for the person and do not hand the page over yourself: Foundry opens every delivered page headless when you finish, fails the task on script errors or an empty page, and screenshots it for the person. Colorfigures' own headless-Chrome checks from every side are part of its workflow: run them when a Chrome is available (\`google-chrome\` or \`chromium\` on PATH, or the Mac app the skill names). When \`python3\` or a Chrome is missing here, do what the skill allows without it and say so in your result.
- Keep the manifest named in your task spec (\`docs/artifacts/…\`) up to date: the page's file name, what the figure shows, what each button does.
- Codebase conventions and test suites do not apply here.`;

/** the task reviewer's note on a figure task */
export const FIGURE_REVIEW_TASK = `# Figure review
The deliverable is an interactive HTML page committed in the repository (in the diff, with its source beside it; the worker's own shots under \`artifacts/\` are not). Foundry has opened it headless already: its figure check says whether the page drew without script errors, and names its screenshots. Read the task's manifest (\`docs/artifacts/…\` in the diff), open the screenshots with the Read tool (it renders images) and the page's source, and judge against the task and rubric: the object and its parts are there, the controls the spec names exist, nothing floats or shows through a wall, no footer or credit line. A page missing from disk, a blank or broken drawing, or a named control the page lacks is a blocker; taste stays with the person.`;

/** the goal reviewer's note on a figure goal */
export const FIGURE_REVIEW_GOAL = `# Figure review
This goal's deliverables are interactive HTML pages committed in the repository (in the diff, each with its source beside it); the committed \`docs/artifacts/\` manifests describe them, and Foundry's figure checks opened each page headless (their results are among the checks). Verify every manifest entry exists, open the screenshots the figure checks name with the Read tool, and look for a footer or credit line in each page's source. A page that failed its figure check, is missing, or carries a credit line is a BLOCKER.`;
