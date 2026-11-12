/**
 * Which of a reviewer's verdicts answers a check (ADR-0094). The goal reviewer names each verdict by the check's name;
 * a name that itself holds a colon ("Matches the design: landing page") is easily copied with its rubric or a suffix
 * tacked on, and an exact match then reports "no verdict" and fails a check the reviewer actually passed. Exact
 * wins; else the names are compared without case and surrounding space; else the verdict's name may extend the check's
 * (the rubric appended after a colon, a parenthesis or a dash), and the longest such verdict is taken. A verdict that is
 * only a prefix of the check's name is not a match: it may answer another, shorter check.
 */
export function matchVerdict<V extends { checkName: string }>(verdicts: readonly V[], checkName: string): V | null {
  const exact = verdicts.find((v) => v.checkName === checkName);
  if (exact) return exact;
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const want = norm(checkName);
  const loose = verdicts.find((v) => norm(v.checkName) === want);
  if (loose) return loose;
  const extended = verdicts.filter((v) => {
    const got = norm(v.checkName);
    return got.length > want.length && got.startsWith(want) && /^[\s:(—–-]/.test(got.slice(want.length));
  });
  // the longest extension is the one that carried the whole rubric; a shorter one could be another check's name plus a word
  return extended.sort((a, b) => b.checkName.length - a.checkName.length)[0] ?? null;
}
