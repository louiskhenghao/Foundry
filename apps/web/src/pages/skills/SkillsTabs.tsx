import { useEffect, useState } from 'react';
import { api } from '../../api.ts';
import { useLocation, useNavigate } from 'react-router-dom';
import { Tabs } from '../../ui.tsx';
import { McpPanel } from './McpPanel.tsx';
import { SkillsPage } from './SkillsPage.tsx';

/** The Skills page and the MCP servers (ADR-0016) side by side; /skills#mcp opens the second. */
export function SkillsTabs() {
  const [codex, setCodex] = useState<boolean | null>(null);
  useEffect(() => { api.auth().then((info) => setCodex(info.provider === 'codex')); }, []);
  const { hash } = useLocation();
  const nav = useNavigate();
  const tab = hash === '#mcp' ? 'mcp' : 'skills';
  return (
    <>
      <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 pt-3">
        <Tabs
          tabs={[
            { id: 'skills' as const, label: 'Skills' },
            { id: 'mcp' as const, label: 'MCP servers' },
          ]}
          value={tab}
          onChange={(t) => nav(t === 'mcp' ? '/skills#mcp' : '/skills', { replace: true })}
        />
      </div>
      {tab === 'mcp' ? codex === null ? null : codex ? <div className="max-w-6xl mx-auto p-6 text-sm text-zinc-400">Manage servers with <code>codex mcp</code> or your Codex config.toml. Allow the server in Settings → Safety using its <code>mcp__server</code> prefix. Claude MCP management does not apply to Codex.</div> : <McpPanel /> : <SkillsPage />}
    </>
  );
}
