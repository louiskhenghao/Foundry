import type { EscalationAction } from '@foundry/core/browser';
import { ACTIONS_BY_TRIGGER } from '@foundry/core/browser';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { api, apiForProvider, type EscalationRow } from '../api.ts';
import { FullTextDialog } from '../components/FullTextDialog.tsx';
import { MarkdownPanel } from '../components/Markdown.tsx';
import { suggestEscalation, useEscalationDraft, useEscalationDrafts, useLive } from '../store.ts';
import { UsagePausedBanner } from '../components/UsageBanner.tsx';
import { Badge, Button, Empty, Input, Textarea, ago } from '../ui.tsx';
import { HelpLink } from './HelpPage.tsx';

const TRIGGER_LABEL: Record<string, string> = {
  brief_question: 'Brief question',
  retries_exhausted: 'Retries exhausted',
  boundary_action: 'Wants to leave the workspace',
  budget_exceeded: 'Budget exceeded',
  permission_denial: 'Tool denied',
  milestone: 'Have a look',
  delivery_failed: 'Delivery stopped',
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
};

export function InboxPage() {
  const version = useLive((s) => s.globalVersion);
  const [list, setList] = useState<EscalationRow[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => api.escalations(!all).then(setList).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [version, all]);
  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-3">
      <UsagePausedBanner />
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          Inbox <HelpLink to="when-foundry-needs-you" label="Why Foundry stops and what to press (new tab)" />
        </h1>
        <label className="text-xs text-zinc-400 flex items-center gap-1">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> show answered
        </label>
      </div>
      {!list ? <Empty>Loading…</Empty> : list.length === 0 ? <Empty>Nothing needs you. The engine only asks for: blocking brief questions, exhausted retries, leaving the workspace, exceeded budgets, or denied tools.</Empty> : list.map((e) => <EscalationCard key={e.id} e={e} />)}
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
        newMaxCostUsd: e.provider !== 'codex' && action === 'raise_budget' && cost ? Number(cost) : undefined,
        newMaxDurationMin: action === 'raise_budget' && minutes ? Number(minutes) : undefined,
      });
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={embedded ? 'rounded-lg border border-orange-500/40 bg-orange-500/5 p-3' : 'rounded-lg border border-orange-500/40 bg-orange-500/5 p-4'}>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <Badge state={e.state} />
        <span className="text-sm font-medium">{TRIGGER_LABEL[e.trigger] ?? e.trigger}</span>
        {e.provider && <span className="text-[10px] rounded border border-zinc-700 px-1.5 text-zinc-400">{e.provider === 'codex' ? 'Codex' : 'Claude Code'}</span>}
        {(e.payload as { kind?: string }).kind === 'merge' && <span className="text-[10px] uppercase rounded border border-orange-500/50 text-orange-300 px-1">merge conflict</span>}
        <span className="text-xs text-zinc-500">{ago(e.createdAt)}</span>
        {!embedded && (
          <span className="ml-auto flex items-center gap-3 text-xs">
            {e.taskId && (
              <Link to={`/goals/${e.goalId}?task=${e.taskId}#tasks`} className="underline text-zinc-300">
                open task →
              </Link>
            )}
            <Link to={`/goals/${e.goalId}`} className="underline text-zinc-400">
              open goal
            </Link>
          </span>
        )}
      </div>
      <div className="text-xs text-zinc-300 mb-1">{(e.payload as { kind?: string }).kind === 'merge' ? 'Two pieces of work changed the same files and the automatic merge could not combine them.' : (e.payload as { kind?: string }).kind === 'engine' ? 'The engine itself hit an error (not the model).' : PLAIN[e.trigger] ?? ''}</div>
      {!embedded && (
        <div className="text-xs text-zinc-400 mb-2 min-w-0 truncate">
          <span className="text-zinc-500">goal</span> {e.goalTitle ?? e.goalId}
          {e.taskId && (
            <>
              <span className="text-zinc-600"> › </span>
              <span className="text-zinc-500">task</span> <span className="text-zinc-200">{e.taskTitle ?? e.taskId}</span>
            </>
          )}
        </div>
      )}
      <MarkdownPanel
        title="details"
        source={e.message}
        maxHeight={260}
        actions={
          long && (
            <button type="button" className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:text-zinc-100 hover:border-zinc-500" onClick={() => setFull(true)} title="Read the whole report in a larger window">
              Open full
            </button>
          )
        }
      />
      <FullTextDialog value={full ? { title: TRIGGER_LABEL[e.trigger] ?? e.trigger, text: e.message } : null} onClose={() => setFull(false)} />
      {suggestion && (
        <div className="mt-2 rounded-md border border-sky-500/30 bg-sky-500/5 p-2.5 text-xs space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles size={12} className="text-sky-300" />
            <span className="text-sky-200 font-medium">AI diagnosis</span>
            <span className="text-zinc-500">{suggestion.confidence} confidence · {suggestion.costAvailable === false ? 'cost unavailable' : `$${suggestion.costUsd.toFixed(2)}`}</span>
            <span className="ml-auto text-zinc-400">
              suggests: <b className="text-zinc-200">{ACTION_LABEL[suggestion.action as EscalationAction] ?? suggestion.action}</b>
            </span>
          </div>
          <div className="text-zinc-300 whitespace-pre-wrap">{suggestion.diagnosis}</div>
          {suggestion.action === 'retry_with_hint' && suggestion.hint && <div className="text-zinc-400">Hint filled in below — press <b>Retry with hint</b> to use it.</div>}
          {suggestion.action === 'resolve_manually' && <div className="text-zinc-400">Open <b>Resolve manually</b> and settle the conflict yourself.</div>}
          {suggestion.action === 'skip_task' && <div className="text-zinc-400">The AI thinks this part is not worth pursuing here — your call: <b>Skip task</b>.</div>}
        </div>
      )}
      {e.state === 'open' && mcpDenied.length > 0 && e.taskId && mcpAllowed && mcpToAllow.length === 0 && (
        <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-xs text-zinc-300">
          Refused MCP server: <span className="mono">{mcpNames}</span>. It is already allowed in goals, so something else stopped it — often it needs signing in.{' '}
          <Link to={`/skills?provider=${e.provider}#mcp`} className="underline">
            Check it under Extensions → MCP servers
          </Link>
          , then retry.
        </div>
      )}
      {e.state === 'open' && mcpDenied.length > 0 && (mcpError || !e.provider) && <p className="mt-3 text-xs text-amber-300">{mcpError ?? 'The goal backend is unavailable; MCP permissions cannot be changed here.'}</p>}
      {e.state === 'open' && mcpToAllow.length > 0 && e.taskId && mcpAllowed && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2">
          <span className="text-xs text-zinc-300">
            Refused MCP server: <span className="mono">{mcpNames}</span> — goals may only use servers you allowed.
          </span>
          <Button size="sm" variant="primary" disabled={busy} onClick={allowAndRetry} title="Ticks Allowed in goals for this server (Extensions → MCP servers) and retries the task">
            Allow this server and retry
          </Button>
        </div>
      )}
      {e.state === 'open' && actions.includes('retry_with_hint') && (
        <Textarea
          className="mt-3 min-h-[76px] resize-y"
          rows={3}
          placeholder="Hint for the next attempt (optional): the real cause, the files, the command to run, the decision to take…"
          value={hint}
          onChange={(x) => setHint(x.target.value)}
        />
      )}
      {e.state === 'open' ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {canSuggest && (
            <>
              <Button size="sm" disabled={busy || !!suggesting} onClick={() => suggest(false)} title={`The AI reads the task, the failing checks and the last session, explains the cause and writes a hint for you (${e.provider === 'codex' ? 'uses ChatGPT quota; USD cost unavailable' : '≤ $1'})`}>
                <Sparkles size={12} /> {suggesting === 'suggest' ? 'Analysing…' : 'Suggest a hint'}
              </Button>
              <Button size="sm" variant="primary" disabled={busy || !!suggesting} onClick={() => suggest(true)} title="Same analysis; when the answer is 'retry with this hint' it is applied immediately (one extra attempt). Skipping, budget and manual merges are never applied for you.">
                <Sparkles size={12} /> {suggesting === 'apply' ? 'Analysing…' : 'Let AI handle it'}
              </Button>
            </>
          )}
          {actions.includes('retry_with_hint') && (
            <label className="ml-auto flex items-center gap-1.5 whitespace-nowrap text-xs text-zinc-400" title="How many more tries the task gets with this hint">
              extra attempts
              <select className="rounded-md bg-zinc-900 border border-zinc-700 px-1.5 py-1 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500" value={attempts} onChange={(x) => patch(e.id, { attempts: Number(x.target.value) })}>
                {[1, 2, 3, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
          {actions.includes('raise_budget') && (
            <>
              {e.provider !== 'codex' && <Input type="number" min={0.5} step={0.5} className="w-32" placeholder="new max $ (blank = ×2)" value={cost} onChange={(x) => setCost(x.target.value)} />}
              <Input type="number" min={5} step={5} className="w-36" placeholder="new max min (blank = ×2)" value={minutes} onChange={(x) => setMinutes(x.target.value)} />
            </>
          )}
          {e.taskId && (e.payload as { kind?: string }).kind === 'merge' && (
            <Link to={`/goals/${e.goalId}/resolve/${e.taskId}`}>
              <Button size="sm" variant="primary" title="See the conflicted files with both sides and resolve them yourself (in the browser or your editor)">
                Resolve manually →
              </Button>
            </Link>
          )}
          {e.trigger === 'milestone' && (
            <Link to={`/goals/${e.goalId}`}>
              <Button size="sm" variant="primary" title="The goal page shows the preview, screenshots and artifacts, and takes your feedback">
                Look &amp; give feedback →
              </Button>
            </Link>
          )}
          {actions.filter((a) => a !== 'resolve_manually' && a !== 'feedback').map((a) => (
            <Button key={a} size="sm" disabled={busy} variant={a === 'abort_goal' || a === 'deny' ? 'danger' : a === 'retry_with_hint' || a === 'approve' || a === 'raise_budget' || a === 'retry_delivery' ? 'primary' : 'default'} onClick={() => answer(a)} title={!e.taskId && a === 'skip_task' ? 'Finish the goal with what is there; the failing checks are waived (no more review runs)' : !e.taskId && a === 'retry_with_hint' ? "Turn the reviewer's findings into fix tasks (your hint rides along), run them, then review again" : undefined}>
              {a === 'skip_task' && !e.taskId ? 'Accept as-is (finish goal)' : ACTION_LABEL[a]}
            </Button>
          ))}
          {err && <span className="text-xs text-rose-400">{err}</span>}
        </div>
      ) : (
        <div className="mt-2 text-xs text-zinc-400">
          answered: {e.answer?.action}
          {e.answer?.hint ? ` — "${e.answer.hint}"` : ''}
        </div>
      )}
    </div>
  );
}
