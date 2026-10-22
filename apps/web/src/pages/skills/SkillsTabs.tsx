import { AGENT_PROVIDERS } from '@foundry/core/browser';
import { useEffect } from 'react';
import { api, type AgentProvider } from '../../api.ts';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ProviderSelector } from '../../components/ProviderSelector.tsx';
import { Loading, PageHeader, Tabs } from '../../ui.tsx';
import { CodexPluginsPanel } from './CodexPluginsPanel.tsx';
import { McpPanel } from './McpPanel.tsx';
import { SkillsPage } from './SkillsPage.tsx';

/** The Skills page and the MCP servers (ADR-0016) side by side; /skills#mcp opens the second. */
export function SkillsTabs() {
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const nav = useNavigate();
  const rawProvider = params.get('provider');
  const provider: AgentProvider | null = AGENT_PROVIDERS.find((p) => p === rawProvider) ?? null;
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
  const tab = hash === '#mcp' ? 'mcp' : hash === '#plugins' && provider === 'codex' ? 'plugins' : 'skills';
  if (!provider) return <Loading size="page" label="Loading extensions…" />;
  const go = (value: AgentProvider, section: string) => {
    const next = new URLSearchParams(params);
    next.set('provider', value);
    nav(`/skills?${next}${section === 'mcp' ? '#mcp' : section === 'plugins' && value === 'codex' ? '#plugins' : ''}`, { replace: true });
  };
  return (
    <>
      {/* the page's head as the top bar names it, with the coding agent whose extensions it shows; its tabs under it */}
      <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 pt-6 md:pt-9">
        <PageHeader title="Extensions" actions={<ProviderSelector value={provider} onChange={(id) => go(id, tab)} />} />
        <Tabs
          tabs={[
            { id: 'skills' as const, label: 'Skills' },
            { id: 'mcp' as const, label: 'MCP servers' },
            ...(provider === 'codex' ? [{ id: 'plugins' as const, label: 'Plugins' }] : []),
          ]}
          value={tab}
          onChange={(t) => go(provider, t)}
        />
      </div>
      {tab === 'plugins' ? <CodexPluginsPanel /> : tab === 'mcp' ? (provider === 'agy' ? <AgyMcpNote /> : <McpPanel key={`mcp:${provider}`} provider={provider} />) : <SkillsPage key={`skills:${provider}`} provider={provider} />}
    </>
  );
}

/** Antigravity keeps its MCP servers in agy: Foundry neither lists nor changes them (the server refuses it) */
function AgyMcpNote() {
  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6">
      <div className="rounded-lg border border-line bg-panel p-4 text-sm text-ink space-y-2">
        <p>Antigravity keeps its MCP servers itself, and Foundry neither lists nor changes them.</p>
        <p className="text-xs text-ink-soft">Add one with <span className="mono font-semibold text-ink">agy mcp add</span> and list them with <span className="mono font-semibold text-ink">agy mcp list</span>, in a terminal on this computer.</p>
      </div>
    </div>
  );
}
