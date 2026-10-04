import { expect, test } from 'bun:test';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeRunner, makeRepo } from '../../engine/src/test-helpers.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from './app.ts';

for (const launch of ['claude', 'codex'] as const) test(`escalation responses retain each goal's backend in a ${launch}-default instance`, async () => {
  const home=mkdtempSync(join(tmpdir(),'foundry-escalation-provider-'));
  const repo=await makeRepo();
  const engine=new Engine(defaultConfig(resolve(import.meta.dir,'../../..'),{provider:launch,dataDir:home,claudeHome:join(home,'claude'),codexHome:join(home,'codex'),useGraphify:false,log:()=>{}}),new FakeRunner(()=>{}));
  engine.beginUpdateDrain();
  const app=createApp(engine);
  try {
    for (const provider of ['claude','codex'] as const) {
      const goal=await engine.createGoal({provider,prompt:`${provider} permission fixture`,repoPath:repo,nature:'code'});
      engine.store.append({type:'escalation.raised',goalId:goal.id,payload:{escalation:{id:`esc_${provider}`,goalId:goal.id,taskId:null,attemptId:null,trigger:'permission_denial',message:'MCP permission required',payload:{denials:[{tool_name:'mcp__example__search'}]},state:'open',answer:null,createdAt:new Date().toISOString(),answeredAt:null,suggestion:null}}});
      const detail=await (await app.request(`/api/goals/${goal.id}`)).json();
      expect(detail.escalations[0].provider).toBe(provider);
    }
    const inbox=await (await app.request('/api/escalations?open=1')).json();
    expect(Object.fromEntries(inbox.map((e:any)=>[e.id,e.provider]))).toEqual({esc_claude:'claude',esc_codex:'codex'});
  } finally {
    await engine.stop();
    for (const path of [home,repo,`${repo}-foundry`]) rmSync(path,{recursive:true,force:true});
  }
});
