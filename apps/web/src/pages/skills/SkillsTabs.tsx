import { useEffect } from 'react';
import { api, type AgentProvider } from '../../api.ts';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ProviderSelector } from '../../components/ProviderSelector.tsx';
import { Empty, Tabs } from '../../ui.tsx';
import { CodexPluginsPanel } from './CodexPluginsPanel.tsx';
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
  const tab = hash === '#mcp' ? 'mcp' : hash === '#plugins' && provider === 'codex' ? 'plugins' : 'skills';
  if (!provider) return <Empty>Loading extensions…</Empty>;
  const go = (value: AgentProvider, section: string) => {
    const next = new URLSearchParams(params);
    next.set('provider', value);
    nav(`/skills?${next}${section === 'mcp' ? '#mcp' : section === 'plugins' && value === 'codex' ? '#plugins' : ''}`, { replace: true });
  };
  return (
    <>
      <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 pt-3 space-y-3">
        <ProviderSelector value={provider} onChange={(id) => go(id, tab)} />
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
      {tab === 'plugins' ? <CodexPluginsPanel /> : tab === 'mcp' ? <McpPanel key={`mcp:${provider}`} provider={provider} /> : <SkillsPage key={`skills:${provider}`} provider={provider} />}
    </>
  );
}
