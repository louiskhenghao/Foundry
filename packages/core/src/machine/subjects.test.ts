import { describe, expect, test } from 'bun:test';
import type { BriefSubject, SubjectPicture } from '../schema/subject.ts';
import { SUBJECT_LIMITS } from '../schema/subject.ts';
import { applySubjectEvent, mergeSubjects, nextSubjectKey, subjectSearchDue } from './subjects.ts';

const pic = (file: string, source: SubjectPicture['source'] = 'web'): SubjectPicture => ({ file, source, url: source === 'web' ? `https://example.com/${file}` : null, caption: 'front' });
const subject = (key: string, name: string, pictures: SubjectPicture[] = []): BriefSubject => ({ key, name, lookFor: 'the silhouette', pictures, search: null });
const at = '2026-10-18T10:00:00.000Z';
const base = { id: 'e1', ts: at, goalId: 'g1' };

describe('Subject events on a Brief', () => {
  test('naming adds a Subject; naming it again changes the words and keeps its pictures and search', () => {
    let s = applySubjectEvent([], { ...base, type: 'brief.subject_set', payload: { subject: { key: 'P1', name: 'Car', lookFor: 'nose' } } }, at);
    expect(s).toEqual([{ key: 'P1', name: 'Car', lookFor: 'nose', pictures: [], search: null }]);
    s = applySubjectEvent(s, { ...base, type: 'brief.subject_searched', payload: { subjectKey: 'P1', status: 'ok', pictures: [pic('P1-1.jpg')], costUsd: 1, detail: '1 picture' } }, at);
    s = applySubjectEvent(s, { ...base, type: 'brief.subject_set', payload: { subject: { key: 'P1', name: 'Car, 2020', lookFor: 'nose and tail' } } }, at);
    expect(s[0]).toMatchObject({ name: 'Car, 2020', lookFor: 'nose and tail', pictures: [pic('P1-1.jpg')], search: { status: 'ok', detail: '1 picture', at } });
  });

  test('a search appends what it kept, never a file twice, never past the limit; a failed one is recorded', () => {
    let s = [subject('P1', 'Car', [pic('P1-1.jpg')])];
    s = applySubjectEvent(s, { ...base, type: 'brief.subject_searched', payload: { subjectKey: 'P1', status: 'ok', pictures: [pic('P1-1.jpg'), pic('P1-2.jpg')], costUsd: 1, detail: '' } }, at);
    expect(s[0]!.pictures.map((p) => p.file)).toEqual(['P1-1.jpg', 'P1-2.jpg']);
    const many = Array.from({ length: 12 }, (_, i) => pic(`P1-${i + 3}.jpg`));
    s = applySubjectEvent(s, { ...base, type: 'brief.subject_searched', payload: { subjectKey: 'P1', status: 'ok', pictures: many, costUsd: 1, detail: '' } }, at);
    expect(s[0]!.pictures).toHaveLength(SUBJECT_LIMITS.pictures);
    s = applySubjectEvent(s, { ...base, type: 'brief.subject_searched', payload: { subjectKey: 'P1', status: 'failed', pictures: [], costUsd: 0.2, detail: 'no network' } }, at);
    expect(s[0]!.search).toEqual({ status: 'failed', detail: 'no network', at });
  });

  test("the person's pictures come and go; removing the Subject removes it", () => {
    let s = [subject('P1', 'Car', [pic('P1-1.jpg')]), subject('P2', 'Tower')];
    s = applySubjectEvent(s, { ...base, type: 'brief.subject_pictures', payload: { subjectKey: 'P1', added: [pic('P1-2.png', 'person')], removed: ['P1-1.jpg'] } }, at);
    expect(s[0]!.pictures).toEqual([pic('P1-2.png', 'person')]);
    s = applySubjectEvent(s, { ...base, type: 'brief.subject_removed', payload: { subjectKey: 'P1' } }, at);
    expect(s.map((x) => x.key)).toEqual(['P2']);
  });

  test('Foundry searches by itself only for a Subject with no pictures that was never searched', () => {
    expect(subjectSearchDue(subject('P1', 'Car'))).toBe(true);
    expect(subjectSearchDue(subject('P1', 'Car', [pic('a.jpg', 'person')]))).toBe(false);
    expect(subjectSearchDue({ ...subject('P1', 'Car'), search: { status: 'failed', detail: '', at } })).toBe(false);
  });

  test('merging keeps the first of a name and its pictures, renames a taken key, and stops at the limit', () => {
    const kept = [subject('P1', 'Porsche 911 GT3', [pic('P1-1.jpg')])];
    const fresh = [subject('P1', 'porsche  911 gt3'), subject('P1', 'Sydney Opera House'), subject('P3', 'Eiffel Tower'), subject('P4', 'Big Ben'), subject('P5', 'Golden Gate')];
    const merged = mergeSubjects(kept, fresh);
    expect(merged.map((s) => [s.key, s.name])).toEqual([['P1', 'Porsche 911 GT3'], ['P2', 'Sydney Opera House'], ['P3', 'Eiffel Tower'], ['P4', 'Big Ben']]);
    expect(merged[0]!.pictures).toHaveLength(1);
    expect(nextSubjectKey(merged)).toBe('P5');
  });
});
