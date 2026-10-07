import { AlertTriangle, CheckCircle2, ChevronRight, CircleDashed, ExternalLink, Loader2, RotateCcw, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api, type GoalDetail } from '../../api.ts';
import { openFile } from '../../components/FilePreview.tsx';
import { Button, Card, CopyButton, cn, fmtUsd } from '../../ui.tsx';

type Status = 'ok' | 'partial' | 'failed' | 'skipped' | 'pending' | 'running';
const ICON: Record<Status, ReactNode> = {
  ok: <CheckCircle2 size={14} className="text-emerald-400" />,
  partial: <AlertTriangle size={14} className="text-amber-400" />,
  failed: <XCircle size={14} className="text-rose-400" />,
  skipped: <CircleDashed size={14} className="text-zinc-500" />,
  pending: <CircleDashed size={14} className="text-zinc-600" />,
  running: <Loader2 size={14} className="text-blue-400 animate-spin" />,
};
const DOC_LABEL: Record<string, string> = { 'to-prd': 'PRD', 'readme-update': 'README and docs', changelog: 'Changelog', 'to-questionnaire': 'Stakeholder questionnaire' };
const TOOL_LABEL: Record<string, string> = { pull: 'Update your checkout', graphify: 'graphify knowledge graph', gitnexus: 'GitNexus index' };
const TOOL_STATUS: Record<string, string> = { ok: 'border-emerald-500/30 text-emerald-300', failed: 'border-rose-500/40 text-rose-300', skipped: 'border-zinc-700 text-zinc-500' };

/** One completion action: what it is, how it went in a line, and the details behind it (open when something went wrong). */
function Row({ status, label, summary, action, open, children }: { status: Status; label: string; summary: ReactNode; action?: ReactNode; open?: boolean; children?: ReactNode }) {
  const [expanded, setExpanded] = useState(!!open);
  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">{ICON[status]}</span>
        <div className="min-w-0 flex-1 flex items-baseline gap-x-2 gap-y-0.5 flex-wrap">
          <button type="button" disabled={!children} onClick={() => setExpanded((e) => !e)} aria-expanded={children ? expanded : undefined} className="inline-flex items-center gap-1 text-zinc-200 font-medium enabled:hover:text-zinc-50">
            {label}
            {children && <ChevronRight size={12} className={cn('text-zinc-500 transition-transform', expanded && 'rotate-90')} />}
          </button>
          <span className="text-zinc-400 min-w-0">{summary}</span>
        </div>
        {action}
      </div>
      {children && expanded && <div className="mt-1.5 ml-6 space-y-1.5">{children}</div>}
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
  if (!c.graphRefresh && !c.docs.length && !c.artifactsRun) return null;
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
      {docs.files.length} file{docs.files.length === 1 ? '' : 's'}
      {docs.ref && <span className="mono text-zinc-500"> · {docs.ref.slice(0, 7)}</span>}
      {g.provider !== 'codex' && docs.costUsd > 0 && <span className="text-zinc-500"> · {fmtUsd(docs.costUsd)}</span>}
      {docsPr?.url && (
        <a href={docsPr.url} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-sky-300 hover:underline">
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
  return (
    <Card title="Completion">
      <ul className="text-xs divide-y divide-zinc-800/70">
        {c.docs.length > 0 && (
          <Row status={docsStatus} label="Docs" summary={docsSummary} open={docs?.status === 'failed'} action={docs?.status !== 'ok' && rerunButton('docs', docsBusy)}>
            <div className="flex flex-wrap gap-1.5">
              {c.docs.map((t) => (
                <span key={t} className="rounded border border-zinc-700 px-1.5 py-px text-[11px] text-zinc-300" title={t}>
                  {DOC_LABEL[t] ?? t}
                </span>
              ))}
            </div>
            {docs && docs.files.length > 0 && (
              <ul className="space-y-0.5">
                {docs.files.map((f) => (
                  <li key={f} className="mono text-[11px]">
                    {ws ? (
                      <button type="button" className="text-sky-300 hover:underline break-all text-left" onClick={() => openFile({ path: `${ws}/${f}` })}>
                        {f}
                      </button>
                    ) : (
                      <span className="text-zinc-400 break-all" title="The goal folder was cleaned up after the merge; the file is in your base branch">
                        {f}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {docs && docs.status !== 'ok' && <div className={docs.status === 'failed' ? 'text-rose-300' : 'text-zinc-400'}>{docs.detail}</div>}
            {docs?.status === 'ok' && docs.ref && (
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                commit <span className="mono text-zinc-400">{docs.ref.slice(0, 12)}</span> <CopyButton text={docs.ref} />
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
              <ul className="space-y-1">
                {run.tools.map((t) => (
                  <li key={t.name} className="flex items-start gap-2">
                    <span className={cn('shrink-0 rounded border px-1.5 py-px text-[10px] uppercase tracking-wide', TOOL_STATUS[t.status])}>{t.status}</span>
                    <span className="min-w-0">
                      <span className="text-zinc-200">{TOOL_LABEL[t.name] ?? t.name}</span>
                      {t.detail && <span className={cn('block mono text-[11px] whitespace-pre-wrap break-words', t.status === 'failed' ? 'text-rose-300' : 'text-zinc-500')}>{t.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Row>
        )}
        {art && (
          <Row status={art.status === 'ok' ? 'ok' : art.status === 'failed' ? 'failed' : 'skipped'} label="Artifacts" summary={art.files.length ? `${art.files.length} file${art.files.length === 1 ? '' : 's'}${art.dest ? ` → ${art.dest}` : ''}` : art.status} open={art.status === 'failed'}>
            <div className={art.status === 'failed' ? 'text-rose-300' : 'text-zinc-400'}>{art.detail}</div>
          </Row>
        )}
      </ul>
      {err && <div className="mt-2 text-xs text-rose-300">{err}</div>}
    </Card>
  );
}
