import type { GoalRow } from '../api.ts';

/** A goal and the follow-ups that continue it: the first goal, then each follow-up after the goal it follows, oldest first. */
export interface GoalChain {
  /** the first goal's id */
  id: string;
  root: GoalRow;
  members: GoalRow[];
  /** the newest member: where the work stands now */
  latest: GoalRow;
}

export type ListEntry = { kind: 'goal'; goal: GoalRow } | { kind: 'chain'; chain: GoalChain };

/** what the list can fold, by the id each fold is kept under: every chain of follow-ups, and every main goal with Delegated goals under it */
export function foldable(entries: ListEntry[], children: Map<string, GoalRow[]>): { chains: string[]; parents: string[] } {
  return { chains: entries.flatMap((e) => (e.kind === 'chain' ? [e.chain.id] : [])), parents: [...children.keys()] };
}

/**
 * The Goals list's entries, in the order the goals come (newest first): a goal with follow-ups becomes one chain, placed
 * where its newest member is. A follow-up whose earlier goal is not in `goals` (deleted, or delegated) starts a chain
 * of its own, or stays a single goal.
 */
export function listEntries(goals: GoalRow[]): ListEntry[] {
  const byId = new Map(goals.map((g) => [g.id, g]));
  const parent = (g: GoalRow) => (g.follows && g.follows.goalId !== g.id ? byId.get(g.follows.goalId) : undefined);
  const followers = new Map<string, GoalRow[]>();
  for (const g of goals) {
    const p = parent(g);
    if (p) followers.set(p.id, [...(followers.get(p.id) ?? []), g]);
  }
  const created = (g: GoalRow) => Date.parse(g.createdAt) || 0;
  const rootOf = (g: GoalRow) => {
    // Foundry refuses a link that would close a cycle; should one exist anyway, the walk ends where it closes
    const seen = new Set<string>();
    let cur = g;
    for (let p = parent(cur); p && !seen.has(cur.id); p = parent(cur)) {
      seen.add(cur.id);
      cur = p;
    }
    return cur;
  };
  const members = (root: GoalRow) => {
    const out: GoalRow[] = [];
    const seen = new Set<string>();
    const walk = (g: GoalRow) => {
      if (seen.has(g.id)) return;
      seen.add(g.id);
      out.push(g);
      for (const f of [...(followers.get(g.id) ?? [])].sort((a, b) => created(a) - created(b))) walk(f);
    };
    walk(root);
    return out;
  };
  const entries: ListEntry[] = [];
  // every goal lands in exactly one entry, the first time the list reaches it or a goal of its chain
  const reached = new Set<string>();
  for (const g of goals) {
    if (reached.has(g.id)) continue;
    let chain = members(rootOf(g)).filter((m) => !reached.has(m.id));
    if (!chain.some((m) => m.id === g.id)) chain = [g];
    for (const m of chain) reached.add(m.id);
    const root = chain[0]!;
    if (chain.length < 2) entries.push({ kind: 'goal', goal: root });
    else entries.push({ kind: 'chain', chain: { id: root.id, root, members: chain, latest: chain.reduce((a, b) => (created(b) > created(a) ? b : a)) } });
  }
  return entries;
}
