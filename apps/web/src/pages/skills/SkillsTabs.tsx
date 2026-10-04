import { useEffect } from 'react';
import { api, type AgentProvider } from '../../api.ts';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Empty, Tabs, cn } from '../../ui.tsx';
import { McpPanel } from './McpPanel.tsx';
import { SkillsPage } from './SkillsPage.tsx';

/** The Skills page and the MCP servers (ADR-0016) side by side; /skills#mcp opens the second. */
export function SkillsTabs() {
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const nav = useNavigate();
  const rawProvider = params.get('provider');
  const provider: AgentProvider | null = rawProvider === 'claude' || rawProvider === 'codex' ? rawProvider : null;
  useEffect(() => {
    if (provider) return;
    let alive = true;
    const select = (value: AgentProvider) => {
      if (!alive) return;
      const next = new URLSearchParams(params);
      next.set('provider', value);
      nav(`/skills?${next}${hash}`, { replace: true });
    };
    void api.settings().then((view) => select(view.values.engine.provider)).catch(() => select('claude'));
    return () => { alive = false; };
  }, [provider, params, hash, nav]);
  const tab = hash === '#mcp' ? 'mcp' : 'skills';
  if (!provider) return <Empty>Loading extensions…</Empty>;
  const go = (value: AgentProvider, section: string) => {
    const next = new URLSearchParams(params);
    next.set('provider', value);
    nav(`/skills?${next}${section === 'mcp' ? '#mcp' : ''}`, { replace: true });
  };
  return (
    <>
      <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 pt-3 space-y-3">
        <div className="flex items-center gap-2 flex-wrap" aria-label="Extensions backend"><span className="text-xs text-zinc-400 mr-1">Backend</span>{(['claude', 'codex'] as const).map((id) => <button key={id} type="button" aria-pressed={provider === id} onClick={() => go(id, tab)} className={cn('rounded-md border px-3 py-1.5 text-xs', provider === id ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200')}>{id === 'codex' ? 'Codex' : 'Claude Code'}</button>)}</div>
        <Tabs
          tabs={[
            { id: 'skills' as const, label: 'Skills' },
            { id: 'mcp' as const, label: 'MCP servers' },
          ]}
          value={tab}
          onChange={(t) => go(provider, t)}
        />
      </div>
      {tab === 'mcp' ? <McpPanel key={`mcp:${provider}`} provider={provider} /> : <SkillsPage key={`skills:${provider}`} provider={provider} />}
    </>
  );
}
