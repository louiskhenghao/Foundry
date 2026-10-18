import type { EngineEvent } from '../events.ts';
import { type BriefSubject, SUBJECT_LIMITS } from '../schema/subject.ts';

type SubjectEvent = Extract<EngineEvent, { type: 'brief.subject_set' | 'brief.subject_removed' | 'brief.subject_pictures' | 'brief.subject_searched' }>;

/**
 * A Brief's Subjects after one of their events: a Subject named or changed (pictures and search kept), removed, pictures
 * added or removed, a search ended (its pictures appended, never more than the limit, never one file twice).
 */
export function applySubjectEvent(subjects: BriefSubject[], e: SubjectEvent, ts: string): BriefSubject[] {
  const add = (s: BriefSubject, pictures: BriefSubject['pictures']): BriefSubject['pictures'] => {
    const have = new Set(s.pictures.map((p) => p.file));
    return [...s.pictures, ...pictures.filter((p) => !have.has(p.file) && have.add(p.file))].slice(0, SUBJECT_LIMITS.pictures);
  };
  switch (e.type) {
    case 'brief.subject_set': {
      const { key, name, lookFor } = e.payload.subject;
      if (subjects.some((s) => s.key === key)) return subjects.map((s) => (s.key === key ? { ...s, name, lookFor } : s));
      return [...subjects, { key, name, lookFor, pictures: [], search: null }];
    }
    case 'brief.subject_removed':
      return subjects.filter((s) => s.key !== e.payload.subjectKey);
    case 'brief.subject_pictures': {
      const gone = new Set(e.payload.removed);
      return subjects.map((s) => (s.key === e.payload.subjectKey ? { ...s, pictures: add({ ...s, pictures: s.pictures.filter((p) => !gone.has(p.file)) }, e.payload.added) } : s));
    }
    case 'brief.subject_searched':
      return subjects.map((s) => (s.key === e.payload.subjectKey ? { ...s, pictures: add(s, e.payload.pictures), search: { status: e.payload.status, detail: e.payload.detail, at: ts } } : s));
  }
}

/** a Subject Foundry searches pictures for by itself: none yet, and never searched (a failed or empty search waits for the person) */
export const subjectSearchDue = (s: BriefSubject): boolean => s.pictures.length === 0 && s.search === null;

/** a key no Subject of the Brief has yet: P1, P2… */
export function nextSubjectKey(subjects: Pick<BriefSubject, 'key'>[]): string {
  const taken = new Set(subjects.map((s) => s.key));
  let n = subjects.length + 1;
  while (taken.has(`P${n}`)) n++;
  return `P${n}`;
}

/**
 * Subjects merged in order of precedence: the ones kept (inherited from a main goal or an earlier goal, or on the Brief
 * before a Re-run Clarify) keep their pictures; a later one of the same name (case and spacing aside) is dropped, and a
 * later one whose key is taken gets a new key. At most the limit.
 */
export function mergeSubjects(...lists: BriefSubject[][]): BriefSubject[] {
  const out: BriefSubject[] = [];
  const named = (n: string) => n.trim().toLowerCase().replace(/\s+/g, ' ');
  for (const list of lists) {
    for (const s of list) {
      if (out.some((o) => named(o.name) === named(s.name))) continue;
      out.push(out.some((o) => o.key === s.key) ? { ...s, key: nextSubjectKey(out) } : s);
    }
  }
  return out.slice(0, SUBJECT_LIMITS.subjects);
}
