import { Check, ChevronRight, ExternalLink, Minus, RotateCcw, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AuditFinding, CheckResult } from '@foundry/core/browser';
import { reportsDollars } from '@foundry/core/browser';
import { api, type GoalDetail } from '../../api.ts';
import { openFile } from '../../components/FilePreview.tsx';
import { markFill, type Mark } from '../../components/progress.tsx';
import { Badge, Button, Card, CopyButton, cn, fmtUsd } from '../../ui.tsx';

/** how a row of a checklist stands: Wayfinding's marks, and `part` for a mix of passed and failed */
export type CheckMark = Mark | 'part';

/**
 * A checklist's square, the same wherever a list says how each of its items went (acceptance checks, delivery steps,
 * what ran after the goal): solid ink with a tick when it passed, red with a cross when it failed, hatched while it runs,
 * hollow before it ran, faded when it was skipped. `label` names the state for a screen reader when no word beside it does.
 */
export function CheckSquare({ mark, label, className }: { mark: CheckMark; label?: string; className?: string }) {
  return (
    <span
      {...(label ? { role: 'img', 'aria-label': label, title: label } : { 'aria-hidden': true })}
      className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-[5px]', mark === 'part' ? 'ring-[1.5px] ring-inset ring-bad text-bad-ink' : markFill[mark], mark === 'done' && 'text-on-ink', mark === 'bad' && 'text-on-bad', className)}
    >
      {mark === 'done' ? <Check size={13} strokeWidth={3} /> : mark === 'bad' ? <X size={13} strokeWidth={3} /> : mark === 'part' ? <Minus size={13} strokeWidth={3} /> : null}
    </span>
  );
}

/** an acceptance check's latest result as its square and the word beside it; no result yet is pending */
export const CHECK_RESULT: Record<CheckResult['status'] | 'none', { mark: CheckMark; word: string }> = {
  pass: { mark: 'done', word: 'passing' },
  fail: { mark: 'bad', word: 'failing' },
  error: { mark: 'bad', word: 'error' },
  skipped: { mark: 'off', word: 'skipped' },
  none: { mark: 'next', word: 'pending' },
};

type Status = 'ok' | 'partial' | 'failed' | 'skipped' | 'pending' | 'running';
const MARK: Record<Status, CheckMark> = { ok: 'done', partial: 'part', failed: 'bad', skipped: 'off', pending: 'next', running: 'run' };
const DOC_LABEL: Record<string, string> = { 'to-prd': 'PRD', 'readme-update': 'README and docs', changelog: 'Changelog', 'to-questionnaire': 'Stakeholder questionnaire' };
const TOOL_LABEL: Record<string, string> = { pull: 'Update your checkout', graphify: 'graphify knowledge graph', gitnexus: 'GitNexus index' };
const TOOL_STATUS: Record<string, string> = { ok: 'bg-ok/10 ring-ok/30 text-ok-ink', failed: 'bg-bad/10 ring-bad/40 text-bad-ink', skipped: 'ring-line-strong text-ink-faint' };
/** a small plate in a row: a doc to write, a tool's outcome */
const CHIP = 'rounded-sm px-1.5 py-px ring-1 ring-inset';

/** One completion action: what it is, how it went in a line, and the details behind it (open when something went wrong). */
function Row({ status, label, summary, action, open, children }: { status: Status; label: string; summary: ReactNode; action?: ReactNode; open?: boolean; children?: ReactNode }) {
  const [expanded, setExpanded] = useState(!!open);
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2.5">
        <CheckSquare mark={MARK[status]} />
        <div className="min-w-0 flex-1 flex items-baseline gap-x-2 gap-y-0.5 flex-wrap pt-px">
          <button type="button" disabled={!children} onClick={() => setExpanded((e) => !e)} aria-expanded={children ? expanded : undefined} className="inline-flex items-center gap-1 text-[13px] font-bold text-ink enabled:hover:underline underline-offset-[3px]">
            {label}
            {children && <ChevronRight size={12} className={cn('text-ink-faint transition-transform', expanded && 'rotate-90')} />}
          </button>
          <span className="text-ink-soft min-w-0">{summary}</span>
        </div>
        {action}
      </div>
      {children && expanded && <div className="mt-2 ml-[1.875rem] space-y-1.5">{children}</div>}
    </li>
  );
}

/**
 * What ran after the goal finished: generated docs, the knowledge-graph refresh, media artifacts. Each is a row with its
 * outcome; failures show their reason and can be re-run.
 */
export function CompletionCard({ d }: { d: GoalDetail }) {
  const g = d.goal;
  const c = g.completion;
  // a re-run asked for, until the result it produces (a newer `at`) arrives
  const [rerun, setRerun] = useState<{ docs?: string | null; graph?: string | null }>({});
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();
  if (!c.graphRefresh && !c.docs.length && !c.artifactsRun && !c.audit && !c.qa) return null;
  const finished = g.state === 'done' || g.state === 'over_delivered';
  const docsBusy = 'docs' in rerun && rerun.docs === (c.docsRun?.at ?? null);
  const graphBusy = 'graph' in rerun && rerun.graph === (c.graphRun?.at ?? null);
  const start = async (what: 'docs' | 'graph') => {
    setErr(null);
    try {
      await api.rerunCompletion(g.id, what);
      setRerun((r) => ({ ...r, [what]: what === 'docs' ? (c.docsRun?.at ?? null) : (c.graphRun?.at ?? null) }));
    } catch (e: any) {
      setErr(e.body?.error ?? e.message);
    }
  };
  const rerunButton = (what: 'docs' | 'graph', busy: boolean) =>
    finished && (
      <Button size="sm" variant="ghost" className="shrink-0" disabled={busy} onClick={() => start(what)} title={what === 'graph' ? 'Run the graph refresh again' : d.paths.workspace ? 'Write the docs in the goal folder and commit them to the goal branch' : `The goal folder was cleaned up after the merge: write the docs on a new branch from ${g.delivery.policy.baseBranch ?? g.baseBranch} and open a pull request for them`}>
        <RotateCcw size={12} /> {busy ? 'Running…' : what === 'docs' && !c.docsRun ? 'Generate' : 'Re-run'}
      </Button>
    );

  const docs = c.docsRun;
  const docsPr = docs?.pr ?? g.delivery.prs.find((p) => p.taskId === `${g.id}:docs`);
  const docsStatus: Status = docsBusy ? 'running' : !docs ? 'pending' : docs.status === 'ok' ? 'ok' : docs.status === 'failed' ? 'failed' : 'skipped';
  const docsSummary = docsBusy ? (
    'writing…'
  ) : !docs ? (
    finished ? 'not written yet' : 'written after the goal review passes, committed to the goal branch'
  ) : docs.status === 'ok' ? (
    <>
      <span className="mono">{docs.files.length}</span> file{docs.files.length === 1 ? '' : 's'}
      {docs.ref && <span className="mono text-ink-faint"> · {docs.ref.slice(0, 7)}</span>}
      {reportsDollars(g.provider) && docs.costUsd > 0 && <span className="mono text-ink-faint"> · {fmtUsd(docs.costUsd)}</span>}
      {docsPr?.url && (
        <a href={docsPr.url} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 font-semibold text-work-ink hover:underline">
          PR #{docsPr.number} <ExternalLink size={10} />
        </a>
      )}
    </>
  ) : (
    docs.status
  );

  const run = c.graphRun;
  const failedTools = run?.tools.filter((t) => t.status === 'failed') ?? [];
  const okTools = run?.tools.filter((t) => t.status === 'ok') ?? [];
  const graphStatus: Status = graphBusy ? 'running' : !run ? 'pending' : failedTools.length === 0 ? (okTools.length ? 'ok' : 'skipped') : okTools.length ? 'partial' : 'failed';

  const art = c.artifactsRun;
  const ws = d.paths.workspace;

  const audit = c.auditRun;
  const auditStatus: Status = d.auditRunning ? 'running' : !audit ? 'pending' : audit.status === 'ok' ? (audit.findings.some((f) => f.severity === 'must') ? 'partial' : 'ok') : audit.status === 'failed' ? 'failed' : 'skipped';
  // what the goal did not fix itself: for a follow-up goal
  // what this goal did not fix: everything but the must-fix findings that became fix tasks (and the nice-to-haves)
  const rest = audit?.findings.filter((f) => f.severity !== 'nice' && !f.fixTaskId) ?? [];
  const followUp = () => {
    const text = [`Fix what the audit of "${g.title}" found and this goal did not cover:`, ...rest.map((f) => `- [${f.severity} fix] ${f.title}: ${f.problem}\n  Fix: ${f.fix}${f.files.length ? `\n  Files: ${f.files.join(', ')}` : ''}`)].join('\n');
    nav(`/goals/new?follows=${encodeURIComponent(g.id)}&prompt=${encodeURIComponent(text)}`);
  };
  const qa = c.qaRun;
  const qaStatus: Status = d.qaRunning ? 'running' : !qa ? 'pending' : qa.status === 'ok' ? (qa.results.some((r) => r.status === 'fail') ? 'partial' : 'ok') : qa.status === 'failed' ? 'failed' : 'skipped';
  const QA_TONE: Record<string, string> = { pass: 'text-ok-ink', fail: 'text-bad-ink', skipped: 'text-ink-faint' };
  const SEVERITY_LABEL: Record<AuditFinding['severity'], string> = { must: 'Must fix', should: 'Should fix', nice: 'Nice to have' };
  // only a must-fix is red: a should-fix is ink, a nice-to-have quiet
  const SEVERITY_TONE: Record<AuditFinding['severity'], string> = { must: 'text-bad-ink', should: 'text-ink', nice: 'text-ink-faint' };
  return (
    <Card title="Completion">
      <ul className="text-xs divide-y divide-line">
        {c.audit && (
          <Row
            status={auditStatus}
            label="Audit"
            summary={d.auditRunning ? 'ponytail-audit is reading the finished branch…' : !audit ? 'runs once every task is done, before the final review' : audit.status === 'ok' ? `${audit.detail}${reportsDollars(g.provider) && audit.costUsd > 0 ? ` · ${fmtUsd(audit.costUsd)}` : ''}` : audit.detail}
            open={audit?.status === 'failed' || (audit?.findings.some((f) => f.severity === 'must') ?? false)}
            action={finished && rest.length > 0 && (
              <Button size="sm" variant="info" className="shrink-0" onClick={followUp} title="Start a follow-up goal that fixes what the audit found outside this goal's code">
                Follow-up with the rest
              </Button>
            )}
          >
            {audit?.summary && <p className="text-ink-soft">{audit.summary}</p>}
            {audit?.status === 'ok' && audit.findings.length > 0 && (
              <ol className="space-y-2">
                {audit.findings.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className={cn('shrink-0 w-20 text-[10.5px] font-extrabold uppercase tracking-[0.07em] pt-0.5', SEVERITY_TONE[f.severity])}>{SEVERITY_LABEL[f.severity]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-ink">{f.title}</span>
                      {f.severity === 'must' && f.inScope && <Badge state={f.fixTaskId ? 'done' : 'ready'} className="ml-1.5 normal-case">{f.fixTaskId ? 'fix task created' : "in this goal's code, for a follow-up"}</Badge>}
                      <span className="block text-ink-soft whitespace-pre-wrap">{f.problem}</span>
                      <span className="block text-ink-faint">Fix: {f.fix}</span>
                      {f.files.length > 0 && <span className="block mono text-[11px] text-ink-faint break-all">{f.files.join(', ')}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {audit && audit.status !== 'ok' && <div className={audit.status === 'failed' ? 'text-bad-ink' : 'text-ink-soft'}>{audit.detail}</div>}
          </Row>
        )}
        {c.qa && (
          <Row
            status={qaStatus}
            label="Browser QA"
            summary={d.qaRunning ? 'the finished app is being tried in Chromium…' : !qa ? 'runs once every task is done, before the final review' : qa.status === 'ok' ? `${qa.detail}${reportsDollars(g.provider) && qa.costUsd > 0 ? ` · ${fmtUsd(qa.costUsd)}` : ''}` : qa.detail}
            open={qa?.status === 'failed' || (qa?.results.some((r) => r.status === 'fail') ?? false)}
          >
            {qa?.summary && <p className="text-ink-soft">{qa.summary}</p>}
            {qa?.status === 'ok' && qa.results.length > 0 && (
              <ol className="space-y-2">
                {qa.results.map((r, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className={cn('shrink-0 w-20 text-[10.5px] font-extrabold uppercase tracking-[0.07em] pt-0.5', QA_TONE[r.status])}>{r.status}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-ink">{r.check}</span>
                      {r.must && r.status === 'fail' && <Badge state={r.fixTaskId ? 'done' : 'ready'} className="ml-1.5 normal-case">{r.fixTaskId ? 'fix task created' : 'must check, for a follow-up'}</Badge>}
                      <span className="block text-ink-soft whitespace-pre-wrap">{r.evidence}</span>
                      {r.problem && <span className="block text-bad-ink whitespace-pre-wrap">{r.problem}</span>}
                      {r.fix && <span className="block text-ink-faint">Fix: {r.fix}</span>}
                      {r.shots.length > 0 && (
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          {r.shots.map((f) => (
                            <a key={f} href={`/api/goals/${g.id}/screenshots/${encodeURIComponent(f)}`} target="_blank" rel="noreferrer" title={f}>
                              <img src={`/api/goals/${g.id}/screenshots/${encodeURIComponent(f)}`} alt={f} className="h-16 rounded-md border border-line object-cover hover:border-line-strong" />
                            </a>
                          ))}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {qa && qa.status !== 'ok' && <div className={qa.status === 'failed' ? 'text-bad-ink' : 'text-ink-soft'}>{qa.detail}</div>}
          </Row>
        )}
        {c.docs.length > 0 && (
          <Row status={docsStatus} label="Docs" summary={docsSummary} open={docs?.status === 'failed'} action={docs?.status !== 'ok' && rerunButton('docs', docsBusy)}>
            <div className="flex flex-wrap gap-1.5">
              {c.docs.map((t) => (
                <span key={t} className={cn(CHIP, 'text-[11px] font-semibold ring-line-strong text-ink-soft')} title={t}>
                  {DOC_LABEL[t] ?? t}
                </span>
              ))}
            </div>
            {docs && docs.files.length > 0 && (
              <ul className="space-y-0.5">
                {docs.files.map((f) => (
                  <li key={f} className="mono text-[11px]">
                    {ws ? (
                      <button type="button" className="text-work-ink hover:underline break-all text-left" onClick={() => openFile({ path: `${ws}/${f}` })}>
                        {f}
                      </button>
                    ) : (
                      <span className="text-ink-soft break-all" title="The goal folder was cleaned up after the merge; the file is in your base branch">
                        {f}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {docs && docs.status !== 'ok' && <div className={docs.status === 'failed' ? 'text-bad-ink' : 'text-ink-soft'}>{docs.detail}</div>}
            {docs?.status === 'ok' && docs.ref && (
              <div className="flex items-center gap-1.5 text-[11px] text-ink-faint">
                commit <span className="mono text-ink-soft">{docs.ref.slice(0, 12)}</span> <CopyButton text={docs.ref} />
                {!docsPr && g.delivery.policy.unit === 'task' && g.delivery.policy.mode !== 'local' && <span>· delivered as the last pull request</span>}
              </div>
            )}
          </Row>
        )}
        {c.graphRefresh && (
          <Row
            status={graphStatus}
            label="Graph refresh"
            summary={graphBusy ? 'running…' : !run ? 'runs when the goal is delivered (graphify, and GitNexus when installed)' : failedTools.length ? `${okTools.length} of ${run.tools.length} ok · ${failedTools.map((t) => t.name).join(', ')} failed` : `${okTools.length} of ${run.tools.length} ok`}
            open={failedTools.length > 0}
            action={run && failedTools.length > 0 && rerunButton('graph', graphBusy)}
          >
            {run && (
              <ul className="space-y-1.5">
                {run.tools.map((t) => (
                  <li key={t.name} className="flex items-start gap-2">
                    <span className={cn(CHIP, 'shrink-0 text-[10.5px] font-bold uppercase tracking-[0.07em]', TOOL_STATUS[t.status])}>{t.status}</span>
                    <span className="min-w-0">
                      <span className="font-semibold text-ink">{TOOL_LABEL[t.name] ?? t.name}</span>
                      {t.detail && <span className={cn('block mono text-[11px] whitespace-pre-wrap break-words', t.status === 'failed' ? 'text-bad-ink' : 'text-ink-faint')}>{t.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Row>
        )}
        {art && (
          <Row status={art.status === 'ok' ? 'ok' : art.status === 'failed' ? 'failed' : 'skipped'} label="Artifacts" summary={art.files.length ? `${art.files.length} file${art.files.length === 1 ? '' : 's'}${art.dest ? ` → ${art.dest}` : ''}` : art.status} open={art.status === 'failed'}>
            <div className={art.status === 'failed' ? 'text-bad-ink' : 'text-ink-soft'}>{art.detail}</div>
          </Row>
        )}
      </ul>
      {err && <div className="mt-2 text-xs text-bad-ink">{err}</div>}
    </Card>
  );
}
