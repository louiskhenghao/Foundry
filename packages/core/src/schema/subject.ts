import { z } from 'zod';

/** at most this many Subjects on a Brief, pictures per Subject, and bytes per picture */
export const SUBJECT_LIMITS = { subjects: 4, pictures: 8, pictureBytes: 5 * 1024 * 1024 } as const;

/** the task scenarios whose work has a look a Subject can be seen in; backend, infra, docs, data and research never see Subjects */
const SUBJECT_SCENARIOS: ReadonlySet<string> = new Set(['frontend', 'fullstack', 'mobile', 'image', 'video', 'cad', 'general']);
export const subjectsApply = (scenario: string): boolean => SUBJECT_SCENARIOS.has(scenario);

/**
 * A picture of a Subject: a photo or an official render, kept under `<dataDir>/subjects/<goal>/`, outside the repository
 * and the workspace, so it never lands and is never delivered. It is there to compare with: no session copies, traces or
 * embeds it.
 */
export const SubjectPicture = z.object({
  /** the file's name in the goal's subjects folder */
  file: z.string(),
  /** person = added on the Brief page or attached to the goal; web = found by Foundry's search */
  source: z.enum(['person', 'web']),
  /** the page a web picture was found on */
  url: z.string().nullable().default(null),
  /** what it shows: the view (front three-quarter, side profile, the dashboard…) */
  caption: z.string().default(''),
});
export type SubjectPicture = z.infer<typeof SubjectPicture>;

/** a Subject's last search for pictures */
export const SubjectSearch = z.object({
  status: z.enum(['ok', 'failed']),
  detail: z.string().default(''),
  at: z.string(),
});
export type SubjectSearch = z.infer<typeof SubjectSearch>;

/**
 * A Subject: a real thing the result depicts (a specific vehicle, building, landmark, product or artwork, never a person),
 * named precisely enough to search for pictures of exactly that one, with what must match and its pictures. Workers
 * build from the pictures and every review compares against them.
 */
export const BriefSubject = z.object({
  key: z.string(),
  name: z.string().min(1),
  /** what must match: the proportions, the distinctive features, colours and materials */
  lookFor: z.string().default(''),
  pictures: z.array(SubjectPicture).default([]),
  /** the last search for its pictures; null = never searched (Foundry searches once by itself while the Brief waits) */
  search: SubjectSearch.nullable().default(null),
});
export type BriefSubject = z.infer<typeof BriefSubject>;

/** a Subject as the Clarifier names it: the pictures are the names of the user's attached images that show it */
export const OutputSubject = z.object({
  key: z.string().describe('Short unique key, e.g. P1'),
  name: z.string().describe('What it is, precisely enough to search for pictures of exactly this one: make, model, generation or year, e.g. "Porsche 911 GT3 (992, 2021)" or "Sydney Opera House".'),
  lookFor: z.string().describe('One or two sentences: what must match, e.g. the proportions, the distinctive features, colours and materials.'),
  pictures: z.array(z.string()).default([]).describe('File names of the user\'s attached images that show it; empty when none do.'),
});
export type OutputSubject = z.infer<typeof OutputSubject>;

/** one difference the Likeness review found, said as the fix */
export const LikenessDifference = z.object({
  what: z.string().describe('What differs, said as the fix: what the pictures show and what the shots show instead, e.g. "the nose is rounded and tall; in the pictures it is a low, flat wedge with a light bar across the whole width".'),
  major: z.boolean().describe('true = someone who knows this subject would notice it at a glance.'),
});
export type LikenessDifference = z.infer<typeof LikenessDifference>;

export const LikenessSubject = z.object({
  key: z.string().describe("The Subject's key."),
  shown: z.boolean().describe('Whether any of the shots shows this Subject.'),
  score: z.number().min(0).max(10).nullable().describe('How much it looks like the pictures: 10 = could pass for them at a glance; 8 = clearly this one, details off; 6 = recognisably this one with clear differences; 4 = the same kind of thing, but not this one; 2 = barely related. null when it is not shown.'),
  matches: z.array(z.string()).describe('What already matches, a few words each.'),
  differences: z.array(LikenessDifference).describe('Every difference worth fixing, the most visible first; empty when it is not shown.'),
  shots: z.array(z.string()).describe('The file names of the shots you compared with the pictures.'),
});
export type LikenessSubject = z.infer<typeof LikenessSubject>;

/** what the Likeness review says about one milestone recording */
export const LikenessVerdict = z.object({
  subjects: z.array(LikenessSubject),
  summary: z.string().describe('One or two sentences for the person: how close it is and what stands out.'),
});
export type LikenessVerdict = z.infer<typeof LikenessVerdict>;

/** a Subject with a major difference that the shots show: worth a fix task */
export const majorDifferences = (v: LikenessVerdict): LikenessSubject[] => v.subjects.filter((s) => s.shown && s.differences.some((d) => d.major));
