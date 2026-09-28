import { useLocation, useNavigate } from 'react-router-dom';
import { Tabs } from '../../ui.tsx';
import { McpPanel } from './McpPanel.tsx';
import { SkillsPage } from './SkillsPage.tsx';

/** The Skills page and the MCP servers (ADR-0016) side by side; /skills#mcp opens the second. */
export function SkillsTabs() {
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
      {tab === 'mcp' ? <McpPanel /> : <SkillsPage />}
    </>
  );
}
