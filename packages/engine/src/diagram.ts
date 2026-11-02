/**
 * Diagram goals (ADR-0083): editorial diagrams — an architecture, a flow, a sequence, a timeline, a chart — one
 * self-contained HTML page with an inline SVG each, drawn by the Diagram pack's skill (diagram-design) and committed in
 * the repository with the SVG exported beside it. A diagram is also a task other goals may carry: a document's figure, a
 * README's architecture. What the Clarifier, the planner, the worker and the reviewers are told lives here; the render
 * check that opens each page is checks/diagram.ts.
 */
import type { DiagramPack } from '@foundry/core';

/** the diagram skill as a goal sees it: the pack Settings names and whether it is installed for the goal's coding agent */
export interface DiagramInfo {
  pack: DiagramPack;
  installed: boolean;
}

/** where a diagram's page and SVG go unless the repository keeps diagrams elsewhere */
export const DIAGRAMS_DIR = 'docs/diagrams';
/** the repository's copy of the skill's style guide with a brand's tokens, written once from the website the Brief names */
export const DIAGRAM_STYLE_GUIDE = `${DIAGRAMS_DIR}/style-guide.md`;

const SKILL_LOOK =
  'diagram-design (Cathryn Lavery): 45 diagram types — architecture, flowchart, sequence, state machine, ER, timeline, swimlane, quadrant, radar, tree, org chart, layer stack, Venn, pyramid, Gantt, Sankey, kanban, user journey, deployment, dependency graph, UML class, database schema and the chart types (bar, line, scatter, treemap, heatmap, waterfall) — in a light, a dark and a full-editorial skin: one accent colour, hairline borders, no shadows, a budget of nine nodes and twelve arrows a diagram (over it, an overview and a detail diagram). It redraws draw.io, Mermaid and Excalidraw files, and takes a brand\'s palette and fonts from a website.';

/** is the pack's skill there to draw with */
export const diagramSkillOf = (info: DiagramInfo | null): boolean => !!info && info.pack !== 'none' && info.installed;

/** what the Clarifier is told about a diagram goal: the nature's rules and the skill that draws */
export function diagramClarifySection(info: DiagramInfo | null): string {
  const skill = diagramSkillOf(info)
    ? `The diagram skill in use is ${SKILL_LOOK}`
    : "No diagram skill is installed for this goal's coding agent (Settings → Skills → Diagram skills): the worker draws the page by hand, without one, in the same shape (one HTML page with an inline SVG, the SVG beside it).";
  return `# Nature: diagram
This goal produces editorial diagrams, not software: one self-contained HTML page with an inline SVG per diagram, drawn by a diagram skill the worker invokes, with the SVG exported beside it. Set \`nature: "diagram"\` and plan one task per diagram (scenario \`diagram\`); Areas are the diagrams, or the systems and processes they show.
${skill}
Settle in the Brief, before anything is drawn, for each diagram: what it shows (the parts and their relations, in words, or the draw.io, Mermaid or Excalidraw file to redraw), its type (one of the skill's, or left to the skill's selection guide), where it will be read (a README or docs page → the \`doc-inline\` size, the default; a wiki page → \`doc-wide\`; a slide → \`slide-16x9\`; a link card → \`social-og\`; print → \`print-a4-landscape\`) and the page's file name. Settle once for the goal: the skin (minimal light, the default; minimal dark; or full editorial, with a header, summary cards and a footer), the fonts (the skill's web fonts, or system fonts when the page must open offline) and the brand: the skill's default palette, or a website address whose colours and fonts the skill reads — the project's own site when the repository has one — kept in the repository at \`${DIAGRAM_STYLE_GUIDE}\`. Ask only what a wrong guess would spoil; the rest are assumptions the person can change. Output an empty \`styleOptions\`: the skill's design system is the style, and the brand is a Brief question.
Conventions every diagram task's spec MUST state verbatim:
- the finished page is committed in the repository at \`${DIAGRAMS_DIR}/<name>.html\` (or where the repository already keeps diagrams), with its SVG export beside it at \`${DIAGRAMS_DIR}/<name>.svg\`; the task names both in \`delivers\`
- a document that shows the diagram embeds the SVG (\`![…](diagrams/<name>.svg)\`, relative to the document), never the page
- the task also writes its manifest \`docs/artifacts/<task-slug>.md\` (committed): the page's path, the SVG, the type, what the diagram shows and the assumptions made
- Foundry renders the PNG itself under \`artifacts/\` when the task lands; the worker makes none
Acceptance: Foundry itself opens every delivered page in a headless browser, runs the skill's own self-check on it, fails the task on script errors, a page with no SVG or a self-check that refuses it, and screenshots it for the person — plan no check for that. Add a reviewer check only for what a screenshot can be judged on (the right parts, labels and relations are there, within the skill's budget); command checks only for objective facts (files exist). Never ask about tech stacks and never propose build/test/lint checks. No image model or key is involved.`;
}

/**
 * What a goal of another nature (a document, code, research) is told while a diagram skill is there: a figure a reader
 * would learn from is a diagram task of its own. The Clarifier plans it; the planner cuts it.
 */
export function diagramTasksNote(info: DiagramInfo | null): string {
  if (!diagramSkillOf(info)) return '';
  return `# Diagrams in this goal
A diagram skill is installed (${SKILL_LOOK.split(':')[0]}). When a reader would learn more from a drawing than from prose — an architecture, a flow, a sequence, a timeline, a chart — plan it as a task of its own (scenario \`diagram\`, one per diagram) that delivers \`${DIAGRAMS_DIR}/<name>.html\` and \`${DIAGRAMS_DIR}/<name>.svg\`, placed before the writing or code task that embeds the SVG (\`![…](diagrams/<name>.svg)\`, relative to the document or the README). Settle in the Brief what each shows, its type and where it will be read; such a task follows the diagram conventions (Foundry opens its page itself and runs the skill's self-check when the task lands: plan no render check for it, and never build/test/lint checks on it). Do not draw what a sentence or a table says as well.`;
}

/** the planner's rules for a diagram goal */
export const DIAGRAM_PLAN = `# Diagrams
One task per diagram (scenario \`diagram\`), in the order the person would want them; a short research task before a diagram only when the Brief says the facts it shows are missing. Each task's spec states, verbatim, the page's path in the repository (\`${DIAGRAMS_DIR}/<name>.html\` unless the repository keeps diagrams elsewhere) and its SVG beside it (\`${DIAGRAMS_DIR}/<name>.svg\`), both named in \`delivers\`, the manifest \`docs/artifacts/<task-slug>.md\`, and the Brief's answers for that diagram: what it shows, the type, the size, the skin, the fonts and the brand (the skill's default, or the website whose tokens live in \`${DIAGRAM_STYLE_GUIDE}\`). Independent diagrams are independent tasks and run in parallel; when the brand comes from a website, the first diagram task writes \`${DIAGRAM_STYLE_GUIDE}\` and the others depend on it. Never build/test/lint checks; Foundry opens each page itself and runs the skill's self-check when the task lands, so plan no render check. A command check that reads the page (a label present) MUST fail when the page is missing: \`test -f ${DIAGRAMS_DIR}/<name>.html && grep …\`, never a bare \`grep\`.`;

/** the worker's conventions on a diagram task */
export const DIAGRAM_WORKER_CONVENTIONS = `# Diagram conventions
- Invoke the diagram skill the Workflow skills section mandates and follow it: its selection guide picks the type (a semantic pattern first when behaviour carries the meaning), that type's reference owns the layout, its connector rules and complexity budget hold (nine nodes, twelve arrows, two accents; over it, split into an overview and a detail diagram).
- The Brief has answered the skill's first-run gate and its confirm-before-drawing pause: the skin, the brand, the fonts, the size and the type are settled there. Never ask; note an assumption you had to make in the manifest.
- The brand: when the Brief chose the skill's default, use the skill's style guide as shipped and write nothing. When it names a website, and \`${DIAGRAM_STYLE_GUIDE}\` is not in the repository yet, follow the skill's onboarding from that address but write the result into \`${DIAGRAM_STYLE_GUIDE}\` (a full copy of the skill's style guide with the brand's tokens), commit it, and resolve every token against it; when the file exists already, read it and skip the onboarding. Never edit the installed skill's own files: every goal shares them.
- The finished page is one self-contained .html committed in the repository at the path the task's \`delivers\` names (\`${DIAGRAMS_DIR}/<name>.html\` unless the repository keeps diagrams elsewhere). Export the SVG beside it with the skill's \`scripts/export_svg.py\` (\`--system-fonts\` when the Brief chose system fonts) and commit both. Make no PNG: the skill's PNG exporter needs a Python Playwright that is not installed here, and Foundry renders \`artifacts/diagrams/<name>.png\` itself when you finish.
- Run the skill's \`scripts/self_check.py\` on the page before you finish and fix what it refuses; Foundry runs it again.
- Do not open a browser window for the person and do not hand the page over yourself: Foundry opens every delivered page headless when you finish, fails the task on script errors, a page with no SVG or a self-check that refuses it, and screenshots it for the person.
- Keep the manifest named in your task spec (\`docs/artifacts/…\`) up to date: the page's path, the SVG, the type, what the diagram shows, the assumptions you made. A document that shows the diagram embeds the SVG, never the page.
- Codebase conventions and test suites do not apply here.`;

/** the task reviewer's note on a diagram task */
export const DIAGRAM_REVIEW_TASK = `# Diagram review
The deliverable is an HTML page with an inline SVG committed in the repository, its SVG export beside it (both in the diff). Foundry has opened it headless already: its diagram check says whether the page drew without script errors and passed the skill's self-check, and names its screenshot. Read the task's manifest (\`docs/artifacts/…\` in the diff), open the screenshot with the Read tool (it renders images) and the page's source, and judge against the task and rubric: the parts, labels and relations the spec names are there, nothing overlaps or runs off the canvas, the accent sits on one or two elements, the SVG export is there. A page missing from disk, a failed diagram check, a missing SVG, or a named part the diagram lacks is a blocker; taste stays with the person.`;

/** the goal reviewer's note on a diagram goal */
export const DIAGRAM_REVIEW_GOAL = `# Diagram review
This goal's deliverables are HTML pages with inline SVGs committed in the repository, each with its SVG export beside it (in the diff); the committed \`docs/artifacts/\` manifests describe them, and Foundry's diagram checks opened each page headless (their results are among the checks). Verify every manifest entry exists, open the screenshots the diagram checks name with the Read tool, and check that each page has its SVG beside it. A page that failed its diagram check, is missing, or has no SVG is a BLOCKER.`;
