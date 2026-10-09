import type { EngineEvent } from '@foundry/core';

/**
 * A stacked delivery opens one pull request per task and, with auto-merge, merges them one after another: a message
 * per PR floods the channel. The digest says it in three messages instead — what is about to open, every PR once they
 * are all open, and the merges once they have gone quiet. A one-PR delivery is left to the usual messages.
 */
export interface DigestMessage {
  goalId: string;
  text: string;
  path: string | null;
}

export interface DigestOptions {
  /** a stack whose PRs have not all opened by then (some already existed) is reported as it stands */
  prWaitMs?: number;
  /** merges are reported once none has come for this long */
  mergeQuietMs?: number;
}

type Opened = { number: number; title: string; url: string };

/** the most PRs one message lists; the rest are counted (the channels cap a message near 2000 characters) */
const LIST_MAX = 12;

export class DeliveryDigest {
  private stacks = new Map<string, { expected: number; opened: Opened[]; timer: ReturnType<typeof setTimeout> }>();
  private merges = new Map<string, { prs: (number | null)[]; timer: ReturnType<typeof setTimeout> }>();
  private prWaitMs: number;
  private mergeQuietMs: number;

  constructor(
    private say: (m: DigestMessage) => void,
    opts: DigestOptions = {},
  ) {
    this.prWaitMs = opts.prWaitMs ?? 15 * 60_000;
    this.mergeQuietMs = opts.mergeQuietMs ?? 2 * 60_000;
  }

  /** true when the digest took the event (it will say it, now or later); false when the usual message should go */
  take(e: EngineEvent, title: string): boolean {
    const goalId = e.goalId;
    if (!goalId) return false;
    const path = `/goals/${goalId}`;
    switch (e.type) {
      case 'delivery.stack_built': {
        const branches = e.payload.branches;
        if (branches.length < 2) return false;
        this.flushStack(goalId, title);
        const list = branches.slice(0, LIST_MAX).map((b, i) => `${i + 1}. ${b.title}`);
        const more = branches.length > LIST_MAX ? [`… and ${branches.length - LIST_MAX} more`] : [];
        this.say({ goalId, text: [`📦 Opening ${branches.length} pull requests — ${title}`, 'One per task, stacked in this order. They come in one message once all are open.', ...list, ...more].join('\n'), path });
        this.stacks.set(goalId, { expected: branches.length, opened: [], timer: unref(setTimeout(() => this.flushStack(goalId, title), this.prWaitMs)) });
        return true;
      }
      case 'delivery.pr_opened': {
        const stack = this.stacks.get(goalId);
        if (!stack) return false;
        stack.opened.push({ number: e.payload.number, title: e.payload.title || title, url: e.payload.url });
        if (stack.opened.length >= stack.expected) this.flushStack(goalId, title);
        return true;
      }
      case 'delivery.merged': {
        const m = this.merges.get(goalId);
        if (m) clearTimeout(m.timer);
        const prs = [...(m?.prs ?? []), e.payload.prNumber];
        this.merges.set(goalId, { prs, timer: unref(setTimeout(() => this.flushMerges(goalId, title), this.mergeQuietMs)) });
        return true;
      }
      case 'delivery.completed':
      case 'delivery.failed':
        // the delivery ended: what was waiting is said first, then the usual message
        this.flushStack(goalId, title);
        this.flushMerges(goalId, title);
        return false;
      default:
        return false;
    }
  }

  /** say everything still waiting (the engine stops) */
  flushAll(title: (goalId: string) => string): void {
    for (const id of [...this.stacks.keys()]) this.flushStack(id, title(id));
    for (const id of [...this.merges.keys()]) this.flushMerges(id, title(id));
  }

  private flushStack(goalId: string, title: string): void {
    const stack = this.stacks.get(goalId);
    if (!stack) return;
    clearTimeout(stack.timer);
    this.stacks.delete(goalId);
    if (!stack.opened.length) return;
    const n = stack.opened.length;
    const head = n === stack.expected ? `🔀 ${n} pull requests opened — ${title}` : `🔀 ${n} of ${stack.expected} pull requests opened — ${title}`;
    const list = stack.opened.slice(0, LIST_MAX).map((p) => `• #${p.number} ${p.title}\n  ${p.url}`);
    const more = n > LIST_MAX ? [`… and ${n - LIST_MAX} more on the goal page`] : [];
    this.say({ goalId, text: [head, ...list, ...more].join('\n'), path: `/goals/${goalId}` });
  }

  private flushMerges(goalId: string, title: string): void {
    const m = this.merges.get(goalId);
    if (!m) return;
    clearTimeout(m.timer);
    this.merges.delete(goalId);
    const numbered = m.prs.filter((p): p is number => p != null);
    const text =
      m.prs.length === 1
        ? `🎉 PR ${numbered.length ? `#${numbered[0]} ` : ''}merged — ${title}`
        : [`🎉 ${m.prs.length} pull requests merged — ${title}`, numbered.length ? numbered.map((p) => `#${p}`).join(', ') : null].filter(Boolean).join('\n');
    this.say({ goalId, text, path: `/goals/${goalId}` });
  }
}

/** a pending digest never keeps the process alive */
function unref<T>(t: T): T {
  (t as { unref?: () => void }).unref?.();
  return t;
}
