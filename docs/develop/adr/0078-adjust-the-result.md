# ADR-0078: Adjust the result — a finished goal carries out the person's words on its result itself, behind a beta switch

**Status:** accepted · 2026-10-25 · builds on [ADR-0073](0073-a-conversation-about-a-goal.md) and [ADR-0076](0076-figure-goals-from-a-bundled-figure-pack.md)

## Context

A goal finishes and the result is nearly right: the lid of the toaster should be red, the chart needs one more line,
the door should open further. Until now every way to get there cost more than the change: a Follow-up is a new goal
that clarifies, plans and starts a fresh session which has to understand everything again; a restart redoes the task
from the Brief; the Conversation (ADR-0073) is read-only, and what the Explainer proposes (ADR-0075) becomes a task
only while the goal runs. Yet the session that did the work is still there to resume — Foundry already resumes a
session cut by a restart or a usage limit (a Continuation), the goal branch holds the work, and the progress folder is
kept after done. The person asked for one thing on a finished goal: *adjust the result*, in their words, with a picture
if it helps, and have the goal do it. Twenty-six decisions of the design interview that also shaped ADR-0076 settled it;
the ones that shape the system are here.

Two things stood in the way. A task that worked in the goal workspace is squashed onto its `baseRef` when it lands:
resuming its session and landing again would squash the adjustment *and* the earlier work into one new commit,
rewriting a branch the person may already have pushed. And artifacts are overwritten in place when a task lands, so an
adjustment would lose the result the person had — the very thing they are comparing against.

## Decision

- **One action, Adjust the result, on a finished goal** (done, over-delivered or failed): the person's words on what
  should change, with up to eight pictures or files, which become attachments of the goal marked with the Adjustment
  (`adjustId`, as a Request's answer is marked). The goal carries it out itself; it never becomes a new goal, and it is
  not a conversation: no answer is written, the work is done. It costs the goal, inside its budget; a goal whose budget
  is used up is refused until the budget is raised.
- **The engine chooses how, by the goal's shape**, and the card says which: a goal of one task whose passed session is
  still there to resume **resumes it** with the words (`resume`); a goal of several tasks gets **a task appended** after
  the finished ones, a fresh session told what each delivered (`task`); a failed goal **runs its failed tasks again**
  with the words (`restart`). A resumed session is a Continuation of a passed Attempt — a new continue reason, `adjust`,
  that counts towards no cap — and keeps the attempt it belongs to; a fresh attempt of a task carrying an Adjustment,
  and its reviewer, are given an *Adjustment asked by the person* section; the goal reviewer is given every Adjustment.
- **The adjustment lands as a commit of its own.** Before the session resumes, the task's `baseRef` moves to the goal
  branch as it stands, so the squash takes only what the adjustment changed — named *… (adjustment n)* — and the task
  reviewer judges that alone; history already pushed is never rewritten. A resumed task gets one fresh attempt beyond
  its budget, should the session not pass its checks.
- **The result as it stood is kept before anything changes:** every artifact, and a figure's committed pages, are copied
  to `artifacts/.history/<n>/` with a manifest. `.history` is never an artifact: not listed, not inherited by a task
  worktree, not copied to the output folder, which holds the latest only; the artifacts route serves it, a page in the
  same sandbox as the current one. The code's earlier versions are the branch's history, as ever.
- **Delivery carries on, never redone.** The output folder gets the new files as after a restart. A branch already
  pushed, or a pull request open or armed to merge, gets the new commit: once the adjusted goal finishes, the delivery
  resumes by itself when an Adjustment came after the last time a delivery was set going (the order of the events says).
  A goal whose work was merged is not adjusted — its branch is gone from the base; a Follow-up is the way — nor one whose
  progress folder was cleaned up, an imported goal held as history, or a Delegated goal (adjust its main goal).
- **A beta,** `beta.adjust`, off by default, as the Conversation and figure goals are: off, the card is hidden and the
  route refused; Adjustments already made stay on the goal, and the earlier versions where they are.

## Consequences

- A finished task can go back to `ready` (the one new task transition), and a passed attempt runs again: readers that
  took `passed` as the end of an attempt's story see a continuation after it, counted in the same attempt's cost.
- The task's `baseRef` is no longer only "the goal branch when the task first started": for a task that was adjusted it
  is the branch when the adjustment began, and its commit the adjustment's. Cumulative review of "all the task's work"
  ends at an Adjustment; the goal reviewer still sees the whole diff against the base.
- The goal's checks run again as they are: an Adjustment that goes against one of them fails it. The checks are the
  Brief's word on what the result must be; changing that is a Follow-up's job, not an Adjustment's.
- `artifacts/.history/` grows with every Adjustment; nothing prunes it but deleting the goal. The output folder never
  sees it, nor a task worktree.
- A pushed branch or an open pull request is updated without the person pressing anything: that is what adjusting a
  delivered result means, and the Delivery tab records the run as a resume.

## Alternatives considered

- **A chat that edits the result** (a message, an answer, another message): what the person wants is the change, not
  an answer; a chat would also need its own cost rules and its own place in the goal's records. An Adjustment is one
  instruction, carried out by the goal's machinery — checks, reviews, delivery — like any task.
- **Always a Follow-up:** correct and already there, but a new goal for one sentence costs a Clarify, a plan and a session
  that has to understand the work again. It stays the way for merged goals and for different work.
- **Always an appended task:** simple, but throws away the session that knows the work; kept as the way when there is no
  such session, or more than one.
- **Rewriting the squash** (one commit for the task, adjustment included): cleaner history, but it rewrites a branch the
  person may have pushed; never.
- **Keeping earlier results in git:** artifacts are kept out of git on purpose (ADR-0005 and after); a folder beside them
  is enough to open an earlier version, and the code's versions are in git already.
