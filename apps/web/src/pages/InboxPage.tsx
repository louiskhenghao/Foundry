import { reportsDollars } from '@foundry/core/browser';
import type { Attachment, EscalationAction } from '@foundry/core/browser';
import { ACTIONS_BY_TRIGGER, needsOf } from '@foundry/core/browser';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Ban, CheckCircle2, Eye, GitPullRequest, HandHelping, HelpCircle, RotateCcw, ShieldAlert, Sparkles, Wallet, type LucideIcon } from 'lucide-react';
import { api, apiForProvider, type EscalationRow } from '../api.ts';
import { FullTextDialog, OpenFullButton } from '../components/FullTextDialog.tsx';
import { AttachmentInput } from '../components/Attachments.tsx';
import { Markdown, MarkdownPanel } from '../components/Markdown.tsx';
import { PROVIDER_STYLE } from '../components/ProviderMark.tsx';
import { suggestEscalation, useEscalationDraft, useEscalationDrafts, useLive } from '../store.ts';
import { UsagePausedBanner } from '../components/UsageBanner.tsx';
import { Button, EmptyState, Input, Loading, NEEDS_YOU_CARD, PageHeader, Textarea, YouStrip, ago, buttonClass, cn, stateLabel } from '../ui.tsx';
import { ProviderBadge } from './agents/rows.tsx';
import { HelpLink } from './HelpPage.tsx';

const TRIGGER_LABEL: Record<string, string> = {
  brief_question: 'Brief question',
  retries_exhausted: 'Retries exhausted',
  boundary_action: 'Wants to leave the workspace',
  budget_exceeded: 'Budget exceeded',
  permission_denial: 'Tool denied',
  milestone: 'Have a look',
  delivery_failed: 'Delivery stopped',
  needs_input: 'Needs something from you',
};
/** one plain sentence per trigger, for people who do not want to read the details */
const PLAIN: Record<string, string> = {
  brief_question: 'The plan has a question only you can answer.',
  retries_exhausted: 'It tried several times and could not finish this part on its own.',
  boundary_action: 'It wants to do something outside the workspace (push, deploy…) and needs your OK.',
  budget_exceeded: 'It reached the money or time limit you set.',
  permission_denial: 'The agent could not use one of the tools it needed.',
  milestone: 'A milestone landed. Look at the result, then continue or say what to change.',
  delivery_failed: 'The delivery stopped. The reason is below; fix it, then retry — or mark it delivered if you finished it yourself.',
  needs_input: 'A task needs something only you can give. What, why and where to get it are below: give it here, or say there is none and it goes on with a stand-in.',
};
const ACTION_LABEL: Record<EscalationAction, string> = {
  retry_with_hint: 'Retry with hint',
  skip_task: 'Skip task (dependents continue)',
  abort_goal: 'Abort goal',
  approve: 'Approve & run once',
  deny: 'Deny',
  raise_budget: 'Raise budget',
  resolve_manually: 'Resolve manually',
  continue: 'Continue',
  feedback: 'Give feedback',
  retry_delivery: 'Retry delivery',
  mark_delivered: 'Mark as delivered',
  provide: 'Send what I gave',
  proceed_without: 'Continue without it',
};

export function InboxPage() {
  const version = useLive((s) => s.globalVersion);
  const [list, setList] = useState<EscalationRow[] | null>(null);
  const [all, setAll] = useState(false);
  // the first load at once; a live change refetches after a short quiet, so a burst of events asks once
  useEffect(() => {
    const t = setTimeout(() => api.escalations(!all).then(setList).catch(() => {}), list === null ? 0 : 150);
    return () => clearTimeout(t);
  }, [version, all]);
  const waiting = list?.filter((e) => e.state === 'open').length ?? 0;
  const answered = (list?.length ?? 0) - waiting;
  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 pt-6 md:pt-9 pb-16">
      <div className="mb-3">
        <UsagePausedBanner />
      </div>
      <PageHeader
        title="Inbox"
        help={<HelpLink to="when-foundry-needs-you" label="Why Foundry stops and what to press (new tab)" />}
        summary={
          list && list.length > 0 ? (
            <>
              {waiting > 0 ? <span className="rounded-[5px] bg-you px-1.5 py-0.5 font-bold text-on-you">{waiting} wait{waiting === 1 ? 's' : ''} for you</span> : 'Nothing waits for you'}
              {/* what was answered is settled: green, as the answered items' tags */}
              {answered > 0 && (
                <>
                  {' · '}
                  <span className="font-semibold text-ok-ink">{answered} answered</span>
                </>
              )}
            </>
          ) : null
        }
        actions={
          <label className="inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-semibold text-ink-soft ring-1 ring-inset ring-line-strong hover:text-ink">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> show answered
          </label>
        }
      />
      {!list ? (
        <Loading label="Loading the Inbox…" />
      ) : list.length === 0 ? (
        // all clear: the tick in green, as everything settled
        <EmptyState icon={CheckCircle2} tone="ok" title="Nothing needs you">
          The engine only asks for: blocking brief questions, exhausted retries, leaving the workspace, exceeded budgets, or denied tools.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {list.map((e) => (
            <EscalationCard key={e.id} e={e} />
          ))}
        </div>
      )}
    </div>
  );
}

/** `embedded` = shown inside the task view: no goal/task links, tighter frame. */
export function EscalationCard({ e, embedded }: { e: EscalationRow; embedded?: boolean }) {
  // hint, attempts and a running analysis are shared with this card on the other screens
  const draft = useEscalationDraft(e.id);
  const patch = useEscalationDrafts((s) => s.patch);
  const { attempts, suggesting } = draft;
  // the newer of what this tab received and what the refetched escalation carries
  const suggestion = draft.suggestion && (!e.suggestion || draft.suggestion.at > e.suggestion.at) ? draft.suggestion : (e.suggestion ?? null);
  const hint = draft.hint ?? (suggestion?.action === 'retry_with_hint' ? suggestion.hint : '');
  const setHint = (v: string) => patch(e.id, { hint: v });
  const [cost, setCost] = useState('');
  const [minutes, setMinutes] = useState('');
  const [busy, setBusy] = useState(false);
  const [answerErr, setErr] = useState<string | null>(null);
  const err = answerErr ?? draft.error;
  const [full, setFull] = useState(false);
  // a Request (ADR-0074): what the task asks for, and the files and links given with the answer (staged until sent)
  const need = needsOf(e);
  const [given, setGiven] = useState<Attachment[]>([]);
  // the details panel scrolls at 260px; a long report also opens in the full-text dialog
  const long = e.message.length > 1200 || e.message.split('\n').length > 12;
  const actions = ACTIONS_BY_TRIGGER[e.trigger];
  const canSuggest = e.taskId && (e.trigger === 'retries_exhausted' || e.trigger === 'permission_denial');
  // the MCP servers whose tools were refused (ADR-0016): mcp__<server>__<tool> → mcp__<server>
  const mcpDenied = e.trigger === 'permission_denial' ? [...new Set(((e.payload as { denials?: { tool_name?: string }[] }).denials ?? []).map((d) => d.tool_name ?? '').filter((t) => t.startsWith('mcp__')).map((t) => t.split('__').slice(0, 2).join('__')))] : [];
  // which of them goals may already use: those were refused for another reason (often a sign-in), so allowing is no fix
  const [mcpAllowed, setMcpAllowed] = useState<string[] | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setMcpAllowed(null);
    setMcpError(null);
    if (mcpDenied.length && e.provider) void apiForProvider(e.provider).mcp().then((v) => {
      if (alive) setMcpAllowed(v.servers.filter((s) => s.allowed).map((s) => s.prefix));
    }).catch(() => { if (alive) setMcpError('Could not read this backend’s MCP permissions. Check Extensions before retrying.'); });
    return () => { alive = false; };
  }, [e.provider, mcpDenied.join(',')]);
  const mcpToAllow = mcpDenied.filter((p) => !mcpAllowed?.includes(p));
  const mcpNames = mcpDenied.map((p) => p.slice('mcp__'.length)).join(', ');
  const allowAndRetry = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (!e.provider || !mcpAllowed) throw new Error('The goal backend and its MCP permissions must be available before allowing a server.');
      for (const p of mcpToAllow) await apiForProvider(e.provider).mcpAllow(p, true);
      await api.answer(e.id, { action: 'retry_with_hint', hint: hint || `The MCP server ${mcpNames} is now allowed in goals; use it.`, extraAttempts: attempts });
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };
  const suggest = (apply: boolean) => {
    setErr(null);
    suggestEscalation(e.id, apply);
  };
  const answer = async (action: EscalationAction) => {
    setBusy(true);
    setErr(null);
    patch(e.id, { error: null });
    try {
      await api.answer(e.id, {
        action,
        hint: hint || undefined,
        extraAttempts: action === 'retry_with_hint' ? attempts : undefined,
        newMaxCostUsd: reportsDollars(e.provider) && action === 'raise_budget' && cost ? Number(cost) : undefined,
        newMaxDurationMin: action === 'raise_budget' && minutes ? Number(minutes) : undefined,
        attachments: action === 'provide' ? given : undefined,
      });
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };
  const kind = (e.payload as { kind?: string }).kind;
  const open = e.state === 'open';
  const Icon = TRIGGER_ICON[e.trigger] ?? AlertTriangle;
  const plain = kind === 'merge' ? 'Two pieces of work changed the same files and the automatic merge could not combine them.' : kind === 'engine' ? 'The engine itself hit an error (not the model).' : kind === 'desktop' ? 'It wants to open a desktop app or hand a file to a printer on this computer (Settings → Safety → Desktop apps & printers is off) and needs your OK.' : (PLAIN[e.trigger] ?? '');
  const choices = actions.filter((a) => a !== 'resolve_manually' && a !== 'feedback');
  const label = (a: EscalationAction) => (a === 'skip_task' && !e.taskId ? 'Accept as-is (finish goal)' : ACTION_LABEL[a]);
  const variant = (a: EscalationAction) => (a === 'abort_goal' || a === 'deny' ? 'danger' : a === 'retry_with_hint' || a === 'approve' || a === 'raise_budget' || a === 'retry_delivery' || a === 'provide' ? 'primary' : 'default');
  const provider = e.provider ? PROVIDER_STYLE[e.provider] : null;
  /** the card's side padding: tighter inside the task view */
  const pad = embedded ? 'px-3 sm:px-4' : 'px-4 sm:px-5';
  // in the strip's own ink on the yellow; a theme whose signs are cards draws the strip as a panel, where ink reads. A
  // thumb's height (32px) on a phone
  const link = cn('inline-flex min-h-8 items-center sm:min-h-0', open ? 'text-on-you hover:underline signs-card:text-ink-soft signs-card:hover:text-ink' : 'text-ink-soft hover:text-ink hover:underline');
  return (
    <section className={NEEDS_YOU_CARD}>
      {/* the head: what stopped in its largest words, one plain sentence, where it belongs when shown outside its task — yellow while it waits */}
      <YouStrip
        quiet={!open}
        icon={Icon}
        title={kind === 'desktop' ? 'Wants to open a desktop app' : (TRIGGER_LABEL[e.trigger] ?? e.trigger)}
        tags={
          <>
            <span className={stripTag(open ? 'open' : e.state === 'answered' ? 'ok' : 'quiet')} title={e.state.replace(/_/g, ' ')}>
              {stateLabel(e.state)}
            </span>
            {kind === 'merge' && <span className={stripTag(open ? 'bad' : 'quiet')}>merge conflict</span>}
          </>
        }
        since={open ? e.createdAt : null}
        aside={
          !embedded && (
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-bold underline-offset-[3px]">
              {e.taskId && (
                <Link to={`/goals/${e.goalId}?task=${e.taskId}#tasks`} className={link}>
                  Open task →
                </Link>
              )}
              <Link to={`/goals/${e.goalId}`} className={link}>
                Open goal →
              </Link>
            </span>
          )
        }
      >
        {plain && <p className={cn('mt-1 max-w-[72ch] text-[15px] leading-snug', !open && 'text-ink-soft')}>{plain}</p>}
        <p className={cn('mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]', open ? 'font-semibold' : 'text-ink-faint')}>
          {!embedded && (
            // a long goal title wraps: cut short, it hid the task's name after it
            <span className="min-w-0 max-w-full break-words">
              {/* an id where the title did not come along (the goal page's own list) */}
              {e.goalTitle ?? <span className="mono">{e.goalId}</span>}
              {e.taskId && (
                <>
                  <span className="opacity-60"> › </span>
                  <span className={open ? 'font-bold' : 'text-ink-soft'}>{e.taskTitle ?? <span className="mono">{e.taskId}</span>}</span>
                </>
              )}
            </span>
          )}
          {provider &&
            (open ? (
              <>
                {/* on the yellow the coding agent is written in the strip's own ink, as on a Goals page sign; where signs
                    are cards the strip is a panel, and the agent keeps its own colour there */}
                <span className="inline-flex items-center gap-1.5 signs-card:hidden" title={`Coding agent: ${provider.label}`}>
                  <provider.Icon size={13} aria-hidden="true" />
                  {provider.label}
                </span>
                <span className="hidden signs-card:inline-flex">
                  <ProviderBadge provider={e.provider ?? undefined} />
                </span>
              </>
            ) : (
              <ProviderBadge provider={e.provider ?? undefined} />
            ))}
          {!open && (
            <time className="mono text-xs" dateTime={e.createdAt} title={new Date(e.createdAt).toLocaleString()}>
              {ago(e.createdAt)}
            </time>
          )}
        </p>
      </YouStrip>

      <div className={cn('space-y-4 py-4', pad)}>
        <MarkdownPanel title="details" source={e.message} maxHeight={260} actions={long && <OpenFullButton onClick={() => setFull(true)} />} />
        <FullTextDialog value={full ? { title: TRIGGER_LABEL[e.trigger] ?? e.trigger, text: e.message } : null} onClose={() => setFull(false)} />
        {suggestion && (
          // the AI's reading is information: its edge, icon and label in the work colour (a panel is never filled with one)
          <div className="overflow-hidden rounded-lg border border-work/45 text-xs">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-work/20 px-3 py-2">
              <Sparkles size={13} className="text-work-ink" aria-hidden="true" />
              <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-work-ink">AI diagnosis</span>
              <span className="text-ink-faint">{suggestion.confidence} confidence · {suggestion.costAvailable === false ? 'cost unavailable' : <span className="mono">${suggestion.costUsd.toFixed(2)}</span>}</span>
              <span className="ml-auto text-ink-soft">
                suggests <b className="text-ink">{ACTION_LABEL[suggestion.action as EscalationAction] ?? suggestion.action}</b>
              </span>
            </div>
            <div className="space-y-1.5 px-3 py-2.5">
              <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{suggestion.diagnosis}</div>
              {suggestion.action === 'retry_with_hint' && suggestion.hint && <div className="text-ink-soft">Hint filled in below — press <b className="text-ink">Retry with hint</b> to use it.</div>}
              {suggestion.action === 'resolve_manually' && <div className="text-ink-soft">Open <b className="text-ink">Resolve manually</b> and settle the conflict yourself.</div>}
              {suggestion.action === 'skip_task' && <div className="text-ink-soft">The AI thinks this part is not worth pursuing here — your call: <b className="text-ink">Skip task</b>.</div>}
            </div>
          </div>
        )}
        {open && mcpDenied.length > 0 && e.taskId && mcpAllowed && mcpToAllow.length === 0 && (
          <div className="rounded-md border border-line bg-sunken px-3 py-2 text-xs text-ink-soft">
            Refused MCP server: <span className="mono text-ink">{mcpNames}</span>. It is already allowed in goals, so something else stopped it — often it needs signing in.{' '}
            <Link to={`/skills?provider=${e.provider}#mcp`} className="font-semibold text-work-ink underline">
              Check it under Extensions → MCP servers
            </Link>
            , then retry.
          </div>
        )}
        {open && mcpDenied.length > 0 && (mcpError || !e.provider) && <p className="text-xs text-bad-ink">{mcpError ?? 'The goal backend is unavailable; MCP permissions cannot be changed here.'}</p>}
        {open && mcpToAllow.length > 0 && e.taskId && mcpAllowed && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-sunken px-3 py-2">
            <span className="text-xs text-ink-soft">
              Refused MCP server: <span className="mono text-ink">{mcpNames}</span> — goals may only use servers you allowed.
            </span>
            <Button size="sm" variant="primary" disabled={busy} onClick={allowAndRetry} title="Ticks Allowed in goals for this server (Extensions → MCP servers) and retries the task">
              Allow this server and retry
            </Button>
          </div>
        )}
        {/* a Request: what the task asks for, why, where to get it; then the answer — words, files and links */}
        {need && (
          <div className="space-y-1.5 text-sm text-ink">
            <p>
              <span className={cn(LABEL, 'mr-2')}>What</span>
              {need.what}
            </p>
            {need.why && (
              <p>
                <span className={cn(LABEL, 'mr-2')}>Why</span>
                {need.why}
              </p>
            )}
            {need.suggestions && (
              <div>
                <span className={LABEL}>Where to get it</span>
                <Markdown source={need.suggestions} className="mt-0.5" />
              </div>
            )}
            <p className="text-xs text-ink-faint">
              {need.source === 'foundry' ? 'You said you would provide this when the goal was planned; the task waits for it.' : need.canProceedWithout ? 'The task could go on without it, with a placeholder.' : 'The task cannot go on without it.'}
            </p>
          </div>
        )}
        {open && actions.includes('provide') && (
          <div className="space-y-1.5">
            <span className={LABEL}>Your answer</span>
            <AttachmentInput items={given} onChange={setGiven} />
            <Textarea className="min-h-[60px] resize-y" rows={2} placeholder="A word with it: which file is which, where it is, or why there is none…" value={hint} onChange={(x) => setHint(x.target.value)} />
          </div>
        )}
        {/* what the answer carries: a hint and its extra attempts, or the new limits */}
        {open && actions.includes('retry_with_hint') && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={LABEL}>Hint for the next attempt</span>
              <span className="text-[11px] text-ink-faint">optional</span>
              <label className="ml-auto flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-soft" title="How many more tries the task gets with this hint">
                extra attempts
                <select className="rounded-md bg-panel border border-line-strong px-1.5 py-0.5 text-xs text-ink focus:outline-none focus:border-accent" value={attempts} onChange={(x) => patch(e.id, { attempts: Number(x.target.value) })}>
                  {[1, 2, 3, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Textarea className="min-h-[76px] resize-y" rows={3} placeholder="The real cause, the files, the command to run, the decision to take…" value={hint} onChange={(x) => setHint(x.target.value)} />
          </div>
        )}
        {open && actions.includes('raise_budget') && (
          // on a phone the label above and each field the width of the card; side by side from sm
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
            <span className={LABEL}>New limits</span>
            {/* the kit's fields fill their box: the boxes give them their width */}
            {reportsDollars(e.provider) && (
              <span className="w-full sm:w-52">
                <Input type="number" min={0.5} step={0.5} placeholder="new max $ (blank = ×2)" value={cost} onChange={(x) => setCost(x.target.value)} />
              </span>
            )}
            <span className="w-full sm:w-52">
              <Input type="number" min={5} step={5} placeholder="new max min (blank = ×2)" value={minutes} onChange={(x) => setMinutes(x.target.value)} />
            </span>
          </div>
        )}
      </div>

      {/* footer: help from the AI on the left, the answers on the right — or what was answered */}
      <footer className={cn('flex flex-wrap items-center gap-2 border-t border-line bg-sunken py-3', pad)}>
        {open ? (
          <>
            {canSuggest && (
              <>
                <Button size="sm" variant="info" disabled={busy || !!suggesting} onClick={() => suggest(false)} title={`The AI reads the task, the failing checks and the last session, explains the cause and writes a hint for you (${e.provider === 'codex' ? 'uses ChatGPT quota; USD cost unavailable' : e.provider === 'agy' ? 'uses Antigravity quota; USD cost unavailable' : '≤ $1'})`}>
                  <Sparkles size={12} /> {suggesting === 'suggest' ? 'Analysing…' : 'Suggest a hint'}
                </Button>
                <Button size="sm" variant="info" disabled={busy || !!suggesting} onClick={() => suggest(true)} title="Same analysis; when the answer is 'retry with this hint' it is applied immediately (one extra attempt). Skipping, budget and manual merges are never applied for you.">
                  <Sparkles size={12} /> {suggesting === 'apply' ? 'Analysing…' : 'Let AI handle it'}
                </Button>
              </>
            )}
            <span className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {err && <span className="text-xs text-bad-ink">{err}</span>}
              {/* links drawn as buttons: a button's 32px on a phone too */}
              {e.taskId && kind === 'merge' && (
                <Link to={`/goals/${e.goalId}/resolve/${e.taskId}`} className={buttonClass('primary', 'sm', 'min-h-8 sm:min-h-0')} title="See the conflicted files with both sides and resolve them yourself (in the browser or your editor)">
                  Resolve manually →
                </Link>
              )}
              {e.trigger === 'milestone' && (
                <Link to={`/goals/${e.goalId}`} className={buttonClass('primary', 'sm', 'min-h-8 sm:min-h-0')} title="The goal page shows the preview, screenshots and artifacts, and takes your feedback">
                  Look &amp; give feedback →
                </Link>
              )}
              {/* the quieter choices first, the main one last (rightmost) */}
              {[...choices].sort((a, b) => RANK[variant(a)] - RANK[variant(b)]).map((a) => (
                <Button key={a} size="sm" disabled={busy} variant={variant(a)} onClick={() => answer(a)} title={!e.taskId && a === 'skip_task' ? 'Finish the goal with what is there; the failing checks are waived (no more review runs)' : !e.taskId && a === 'retry_with_hint' ? "Turn the reviewer's findings into fix tasks (your hint rides along), run them, then review again" : undefined}>
                  {label(a)}
                </Button>
              ))}
            </span>
          </>
        ) : (
          // the answer in one flowing line that wraps on a phone; a long hint stops after three lines (all of it on hover)
          <span className="flex min-w-0 items-start gap-1.5 text-xs text-ink-soft">
            <CheckCircle2 size={13} className="mt-px shrink-0 text-ok-ink" aria-hidden="true" />
            <span className="min-w-0 break-words line-clamp-3" title={e.answer?.hint || undefined}>
              Answered: <b className="whitespace-nowrap text-ink">{ACTION_LABEL[e.answer?.action as EscalationAction] ?? e.answer?.action}</b>
              {e.answer?.hint ? <span> — “{e.answer.hint}”</span> : null}
              {e.answeredBy ? <span className="whitespace-nowrap text-ink-faint"> · by {e.answeredBy}</span> : null}
            </span>
          </span>
        )}
      </footer>
    </section>
  );
}

/** a label in small capitals above a field */
const LABEL = 'text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint';

/**
 * A small plate in a strip's title line, in the colour of how it stands: open in the strip's own ink on the yellow (where
 * signs are cards the strip is a panel, and the plate takes the yellow itself), answered green, a merge conflict that
 * still waits red; quiet once it no longer counts (dismissed, an answered conflict).
 */
const STRIP_TAG = {
  open: 'ring-[1.5px] ring-on-you/45 text-on-you signs-card:ring-you/60 signs-card:text-you-ink',
  ok: 'bg-ok/10 text-ok-ink ring-1 ring-ok/50',
  bad: 'bg-bad text-on-bad',
  quiet: 'ring-[1.5px] ring-line-strong text-ink-soft',
};
const stripTag = (tone: keyof typeof STRIP_TAG) => cn('inline-flex items-center whitespace-nowrap rounded-sm px-1.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.08em] leading-none ring-inset', STRIP_TAG[tone]);

/** a trigger's icon in the card's header */
const TRIGGER_ICON: Record<string, LucideIcon> = {
  brief_question: HelpCircle,
  retries_exhausted: RotateCcw,
  boundary_action: ShieldAlert,
  budget_exceeded: Wallet,
  permission_denial: Ban,
  milestone: Eye,
  delivery_failed: GitPullRequest,
  needs_input: HandHelping,
};
/** buttons in the footer, quieter first so the main answer sits rightmost */
const RANK: Record<string, number> = { default: 0, danger: 1, primary: 2 };
