# Prefill the New goal form from the last goal in the folder

## Objective

New goals in the same repository folder start with its latest workflow choices. Settings remain the fallback, and a Follow-up opened from a goal page takes precedence over folder defaults.

## Scope

The web form inherits **Workflow suite** (`workflow.profile`, the **Powered by** row), **TDD** and **Ponytail**. The engine supplies the source through the existing repository-validation API. Other Settings defaults, CLI creation behavior, and the linking-only **Follows** picker retain their existing behavior.

## Implemented behavior

`Engine.lastWorkflowIn(repoPath)` returns `{ goalId, title, createdAt, workflow: { profile, tdd, ponytail } }` or `null`. It uses the newest `createdAt` among Goals whose saved `repoPath` string matches exactly, excluding `isHistory` Goals. Equal timestamps retain `listGoals` ordering. Values reflect current saved state, including later Ponytail changes. A missing legacy profile resolves through `Engine.workflowProfileOf` to the current Settings suite.

`POST /api/validate-repo` accepts `{ repoPath }` and includes the result as `lastGoal`. Repository readiness and errors retain their existing meaning. A saved last Goal can be returned for an invalid folder; the form applies its workflow only when validation reports `ok: true`.

The form tracks inherited fields separately from its `changed` set. For ordinary new goals, starting validation immediately restores Settings for untouched fields and hides the old source note. Successful validation applies the latest folder values. Late Settings responses preserve inherited values, and obsolete validation responses are ignored. Revalidation after pull or git initialization refreshes the source.

## Acceptance criteria

- The newest non-history Goal at the exact folder path supplies all three untouched fields. No matching Goal yields `lastGoal: null` and Settings defaults.
- Manual edits survive Settings and folder responses. The muted Expert-view note under **Powered by** reads `from the last goal in this folder: <title>` while at least one field still inherits from that Goal.
- Outside a goal-page Follow-up, pending, failed, invalid and commitless-folder validation use Settings for untouched fields and hide the note.
- A goal-page Follow-up supplies the earlier Goal's suite, TDD and current saved Ponytail. Later Settings and folder responses cannot replace them, and no folder source note appears. Subsequent manual edits persist.
- The on-page **Follows** picker changes the relationship without prefilling workflow fields. The CLI does not gain TDD or Ponytail inheritance.
- Inherited pstack remains selected when unavailable, with existing installation guidance and engine fallback. Simple view retains suite and Ponytail but submits preferred TDD. Fast mode omits TDD, so the engine defaults it off.
- English and Chinese guides describe the inheritance, fallback, source note and Follow-up precedence without changing existing headings or anchors.

## Differences from the plan

The approved understanding says that a Follow-up overrides all three fields. The implementation preserves TDD and Ponytail edits made before a delayed Follow-up draft arrives; its suite still replaces the current suite. A focused web test explicitly covers this distinction. The original Brief conditioned web tests on existing form coverage; the approved decision expanded that scope to new focused tests and browser verification.

## Verification coverage

Engine tests cover creation ordering, exact paths, history and reattachment, saved Ponytail and legacy values. Server tests cover `lastGoal`, null results and unchanged readiness errors. Web tests cover field protection, source-note tracking and response ordering. The Playwright folder-workflow and Follow-up milestone suites cover the visible form and submitted values. CLI coverage checks that Follow-up creation retains its existing TDD and Ponytail defaults.

User guidance: [The New goal form](../guide/your-first-goal.md#the-new-goal-form) and [New goal defaults](../guide/settings.md#new-goal-defaults).
