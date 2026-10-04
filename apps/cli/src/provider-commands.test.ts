import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const main = resolve(import.meta.dir, 'main.ts');
async function run(args: string[], env: Record<string, string | undefined>) {
  const child = Bun.spawn([process.execPath, main, ...args], { env: { PATH:process.env.PATH,...env }, stdout:'pipe',stderr:'pipe' });
  const [code,out,err] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
  return { code,out,err };
}
async function withServer(work: (url: string, calls: string[]) => Promise<void>, respond: (url: URL, request: Request) => Response = () => Response.json({})) {
  const calls: string[] = [];
  const server = Bun.serve({ hostname:'127.0.0.1',port:0,fetch(request) {
    const url = new URL(request.url);
    calls.push(`${request.method} ${url.pathname}${url.search}`);
    if (url.pathname === '/api/health') return Response.json({ ok:true });
    return respond(url,request);
  } });
  try { await work(`http://127.0.0.1:${server.port}`,calls); }
  finally { server.stop(true); }
}

describe('CLI provider selection and native account ownership', () => {
  test('skills and doctor honor an explicit provider, including routes with existing query parameters', async () => {
    await withServer(async (url,calls) => {
      expect((await run(['skills','list','--repo','/fixture/repo','--provider','codex','--json'], { FOUNDRY_URL:url })).code).toBe(0);
      expect((await run(['doctor','--provider','codex','--json'], { FOUNDRY_URL:url })).code).toBe(0);
      expect(calls).toContain('GET /api/skills?repo=%2Ffixture%2Frepo&provider=codex');
      expect(calls).toContain('GET /api/doctor?provider=codex');
    },url => Response.json(url.pathname === '/api/doctor' ? { ok:true,checks:[] } : { installed:[] }));
  });

  test('offline skills read the selected native home and keep the other provider’s files intact', async () => {
    const home = mkdtempSync(join(tmpdir(),'foundry-cli-homes-'));
    try {
      for (const provider of ['claude','codex']) {
        const path = join(home,provider,'skills',`${provider}-fixture`);
        mkdirSync(path,{recursive:true});
        writeFileSync(join(path,'SKILL.md'),`---\nname: ${provider}-fixture\ndescription: isolated fixture\n---\n`);
      }
      const env = { HOME:home, FOUNDRY_PORT:'1', FOUNDRY_DATA_DIR:join(home,'data'),FOUNDRY_PROVIDER:'claude',FOUNDRY_CLAUDE_HOME:join(home,'claude'),FOUNDRY_CODEX_HOME:join(home,'codex') };
      for (const provider of ['codex','claude']) {
        const result = await run(['skills','list','--provider',provider,'--json'],env);
        expect(result.code).toBe(0);
        const overview = JSON.parse(result.out);
        expect(overview.skillsDir).toBe(join(home,provider,'skills'));
        expect(overview.installed.map((row: any) => row.name)).toContain(`${provider}-fixture`);
        expect(overview.installed.map((row: any) => row.name)).not.toContain(`${provider === 'codex' ? 'claude':'codex'}-fixture`);
      }
    } finally { rmSync(home,{recursive:true,force:true}); }
  });

  test('login follows the running server’s default account and prints its native device flow', async () => {
    await withServer(async (url,calls) => {
      const r = await run(['auth','login'],{FOUNDRY_URL:url,FOUNDRY_CODEX_BIN:'/must/not/run/local'});
      expect(r.code).toBe(0);
      expect(r.out).toContain('fixture device code');
      expect(r.out).toContain('codex: signed in');
      expect(calls).toEqual(['GET /api/health','GET /api/auth?force=1','POST /api/auth/login?provider=codex']);
    },url => Response.json(url.pathname === '/api/auth' ? {provider:'codex',status:{loggedIn:false}} : {id:'fixture',lines:['fixture device code'],done:true,ok:true}));
  });

  test('auth status and skills list remain defaults when only provider flags are supplied', async () => {
    await withServer(async (url,calls) => {
      const auth = await run(['auth','--provider','codex','--json'],{FOUNDRY_URL:url});
      expect(auth.code).toBe(0);
      expect(JSON.parse(auth.out).loggedIn).toBe(true);
      expect((await run(['skills','--provider','codex','--json'],{FOUNDRY_URL:url})).code).toBe(0);
      expect(calls).toContain('GET /api/auth?force=1&provider=codex');
      expect(calls).toContain('GET /api/skills?provider=codex');
    },url => Response.json(url.pathname === '/api/auth' ? {provider:'codex',status:{loggedIn:true}} : {installed:[]}));
  });

  test('update-all does not mistake a provider flag for the target skill', async () => {
    let body: unknown;
    const server = Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request) {
      if (new URL(request.url).pathname === '/api/health') return Response.json({ok:true});
      body = await request.json();
      return Response.json({updated:[],unchanged:[],errors:[]});
    }});
    try {
      const r = await run(['skills','update','--provider','codex'],{FOUNDRY_URL:`http://127.0.0.1:${server.port}`});
      expect(r.code).toBe(0);
      expect(body).toEqual({});
    } finally { server.stop(true); }
  });

  test('server refusal never falls back to native account mutation', async () => {
    await withServer(async (url,calls) => {
      for (const action of ['login','logout']) {
        const r = await run(['auth',action,'--provider','codex'],{FOUNDRY_URL:url,FOUNDRY_CODEX_BIN:'/must/not/run/local'});
        expect(r.code).toBe(1);
        expect(r.err).toContain('409');
        expect(r.err).toContain('Wait for active work');
      }
      expect(calls).toContain('POST /api/auth/logout?provider=codex');
    },url => url.pathname === '/api/auth' ? Response.json({provider:'codex',status:{loggedIn:true}}) : Response.json({error:'Wait for active work'},{status:409}));
  });

  test('an unreachable explicitly configured server cannot silently change the local account', async () => {
    const r = await run(['auth','logout','--provider','codex'],{FOUNDRY_URL:'http://127.0.0.1:1',FOUNDRY_CODEX_BIN:'/must/not/run/local'});
    expect(r.code).toBe(2);
    expect(r.err).toContain('configured Foundry instance');
  });

  test('Claude code handoff retains the server session for the Accounts page', async () => {
    await withServer(async (url,calls) => {
      const r = await run(['auth','login','--provider','claude'],{FOUNDRY_URL:url});
      expect(r.code).toBe(0);
      expect(r.out).toContain(`${url}/accounts`);
      expect(calls.some(call => call.includes('/cancel'))).toBe(false);
    },url => Response.json(url.pathname === '/api/auth' ? {provider:'claude',status:{loggedIn:false}} : {id:'fixture',lines:[],done:false,needsCode:true}));
  });

  test('prints account windows separately from Foundry activity without inventing missing quota', async () => {
    await withServer(async url => {
      const r = await run(['usage','--provider','codex'],{FOUNDRY_URL:url});
      expect(r.code).toBe(0);
      expect(r.out).toContain('allowance unknown');
      expect(r.out).toContain('Research · primary: 42% used; 300 min; reported reset');
      expect(r.out).toContain('secondary: usage unknown; duration unknown; reset unknown');
      expect(r.out).toContain('Foundry activity only:');
      expect(r.out).not.toContain('$0');
    },() => {
      const window = {label:'Local',status:null,sessions:0,inputTokens:0,outputTokens:0,cacheReadTokens:0,costUsd:0};
      return Response.json({provider:'codex',costAvailable:false,codexQuota:{state:'available',ordinaryUsageAllowed:null,buckets:[{label:'Research',primary:{usedPercent:42,windowDurationMins:300,resetsAt:1800000000},secondary:{usedPercent:null,windowDurationMins:null,resetsAt:null}}]},fiveHour:window,sevenDay:window,byModel:[],byKind:[],note:'fixture'});
    });
  });

  test('unknown or missing provider values fail before connecting', async () => {
    for (const flags of [['--provider','invalid'],['--provider']]) {
      const r = await run(['skills','list',...flags],{FOUNDRY_URL:'http://127.0.0.1:1'});
      expect(r.code).toBe(1);
      expect(r.err).toContain('--provider must be');
    }
  });
});
