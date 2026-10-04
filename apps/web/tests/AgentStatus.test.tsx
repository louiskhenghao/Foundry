import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderBadge, StatusDot } from '../src/pages/agents/rows.tsx';
import { SubagentStatus } from '../src/pages/agents/SessionDetail.tsx';

describe('native session identity and status', () => {
  test('unknown liveness stays unknown instead of becoming finished or idle', () => {
    const html = renderToStaticMarkup(<StatusDot status="unknown" />);
    expect(html).toContain('aria-label="Live process state unknown"');
    expect(html).not.toContain('finished');
    expect(html).not.toContain('waiting for input');
    expect(html).not.toContain('animate-pulse');
  });

  test('known process statuses retain their meaning', () => {
    expect(renderToStaticMarkup(<StatusDot status="busy" />)).toContain('aria-label="working"');
    expect(renderToStaticMarkup(<StatusDot status="idle" />)).toContain('aria-label="waiting for input"');
    expect(renderToStaticMarkup(<StatusDot status="finished" />)).toContain('aria-label="finished"');
  });

  test('provider identity does not treat missing metadata as Claude', () => {
    expect(renderToStaticMarkup(<ProviderBadge provider="codex" />)).toContain('Codex');
    expect(renderToStaticMarkup(<ProviderBadge provider="claude" />)).toContain('Claude Code');
    expect(renderToStaticMarkup(<ProviderBadge provider={undefined} />)).toContain('Backend unknown');
  });

  test('native child sessions preserve unknown liveness in lists and detail tabs', () => {
    const html = renderToStaticMarkup(<SubagentStatus status="unknown" />);
    expect(html).toContain('status unknown');
    expect(html).not.toContain('done');
    expect(html).not.toContain('running');
    expect(renderToStaticMarkup(<SubagentStatus status="running" />)).toContain('● running');
    expect(renderToStaticMarkup(<SubagentStatus status="done" />)).toContain('done');
  });
});
