import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { EscalationCard } from '../src/pages/InboxPage.tsx';
import type { EscalationRow } from '../src/api.ts';

const escalation = (provider: EscalationRow['provider'], trigger: EscalationRow['trigger']): EscalationRow => ({id:'escalation',goalId:'goal',taskId:'task',attemptId:null,provider,trigger,message:'Needs help',payload:{denials:[{tool_name:'mcp__example__search'}]},state:'open',answer:null,createdAt:'2026-10-04T00:00:00Z',answeredAt:null,suggestion:null});
const render=(e:EscalationRow)=>renderToStaticMarkup(<StaticRouter><EscalationCard e={e} /></StaticRouter>);

test('recovery controls do not promise USD limits for a ChatGPT-backed goal',()=>{
  expect(render(escalation('claude','budget_exceeded'))).toContain('new max $');
  const budget=render(escalation('codex','budget_exceeded'));
  expect(budget).not.toContain('new max $');
  expect(budget).toContain('new max min');
  const denied=render(escalation('codex','permission_denial'));
  expect(denied).not.toContain('≤ $1');
  expect(denied).not.toContain('Claude refused');
  expect(denied).toContain('uses ChatGPT quota');
});

test('unknown goal ownership does not offer a provider-default MCP permission change',()=>{
  const html=render(escalation(null,'permission_denial'));
  expect(html).toContain('goal backend is unavailable');
  expect(html).not.toContain('Allow this server and retry');
});
