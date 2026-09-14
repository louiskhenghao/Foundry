import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Brief, EscalationAnswer, getAttempt, getBrief, getGoal, listAttempts, listAttemptsByGoal, listCheckResultsByGoal, listChecks, listEscalations, listGoals, listTasks, depths, taskUsage } from '@foundry/core';
import { AttachmentError, BrowseError, DESIGN_PACK_OPTIONS, IMAGE_PACK_OPTIONS, VIDEO_PACK_OPTIONS, DraftRequest, InstallError, abortResolution, canResolve, describeResolution, finishResolution, resolveFile, startResolution, takeSide, unresolveFile, OpenError, SettingsError, attachmentAbsPath, markdownAbsPath, stagedMarkdownAbsPath, fetchBase, pullFastForward, startRef, decodeLine, detectOpenTargets, linkAttachment, openPath, stageFile, TrashError, UninstallRefused, UpdateBusy, budgetStatus, defaultAllowedRoots, exec, gitDiff, goalWorkspacePath, resolveWorkspacePath, screenshotsDir, listArtifacts, PreviewError, classifyFeedback, initRepo, inspectRepo, listDirs, pickFolder, wellKnownRoots, startStyleSample, StyleSampleError, detectTelegramChatId, type Engine, type OpenTargetId } from '@foundry/engine';
import { Attachment, BudgetPreset, DeliveryPolicy, DocType, GoalMode, GoalNature, GoalWorkflow, NotificationSettings, SettingsPatch } from '@foundry/core';
import { Hono } from 'hono';
import { z } from 'zod';

/** Errors that carry their own HTTP status (409/422…) instead of the default 400. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(String(body.error ?? 'error'));
  }
}

/** Partial budgets; null on a limit means "no limit". */
const BudgetsBody = z.object({
  maxCostUsd: z.number().positive().nullable().optional(),
  maxDurationMin: z.number().positive().nullable().optional(),
  maxConcurrent: z.number().int().positive().optional(),
  attemptsPerTask: z.number().int().positive().optional(),
});

const CompletionBody = z.object({
  graphRefresh: z.boolean().optional(),
  docs: z.array(DocType).optional(),
});

const CreateGoalBody = z.object({
  title: z.string().optional(),
  prompt: z.string().min(1),
  repoPath: z.string().min(1),
  baseBranch: z.string().optional(),
  budgets: BudgetsBody.optional(),
  budgetPreset: BudgetPreset.optional(),
  models: z.object({ strong: z.string().optional(), cheap: z.string().optional(), worker: z.string().optional() }).optional(),
  autoBrief: z.object({ mustChecks: z.array(z.string()), stretchChecks: z.array(z.string()).optional() }).optional(),
  brief: Brief.omit({ goalId: true }).optional(),
  delivery: DeliveryPolicy.partial().optional(),
  attachments: z.array(Attachment).optional(),
  mode: GoalMode.optional(),
  workflow: GoalWorkflow.partial().optional(),
  nature: GoalNature.optional(),
  outputDir: z.string().nullable().optional(),
  selfCheck: z.boolean().optional(),
  interview: z.enum(['auto', 'always', 'never']).optional(),
});

export function createApp(engine: Engine, opts: { webDist?: string } = {}) {
  const app = new Hono();
  const db = engine.store.db;

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json(err.body, err.status as 400);
    if (err instanceof InstallError) return c.json({ error: err.message, code: err.code, ...err.extra }, err.code === 'conflict' ? 409 : err.code === 'manual' ? 422 : err.code === 'not-found' ? 404 : 400);
    if (err instanceof UninstallRefused) return c.json({ error: err.message, reason: err.reason }, err.reason === 'not-found' ? 404 : 409);
    if (err instanceof UpdateBusy) return c.json({ error: err.message }, 409);
    if (err instanceof TrashError) return c.json({ error: err.message, code: err.code }, err.code === 'not-found' ? 404 : 409);
    return c.json({ error: String(err.message ?? err) }, 400);
  });

  // `active` = everything a restart would interrupt (sessions + attempts between sessions + clarify/review/delivery); `busy` breaks it down
  app.get('/api/health', (c) => {
    const busy = engine.busy();
    return c.json({
      ok: true,
      active: busy.total,
      busy,
      events: engine.store.count(),
      pausedUntil: engine.rateLimitedUntilIso(),
      restartNeeded: engine.settings.restartNeeded(),
      version: engine.updater.current(),
      updateAvailable: !!engine.updater.cachedReport()?.updateAvailable,
      updating: engine.updater.isApplying() || engine.isUpdateDraining(),
    });
  });

  // ---------- agents monitor (read-through over ~/.claude + engine state; nothing persisted) ----------
  const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const FOUNDRY_ROW_ID = /^foundry-[A-Za-z0-9_-]{1,64}$/; // placeholder id for rows whose session hasn't reported its id yet
  const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

  app.get('/api/agents', (c) => c.json(engine.agents.list()));
  app.get('/api/agents/summary', (c) => c.json(engine.agents.summary()));

  app.get('/api/agents/:sessionId/log', (c) => {
    const sid = c.req.param('sessionId');
    if (!SESSION_ID.test(sid)) throw new HttpError(400, { error: 'bad session id' });
    const agent = c.req.query('agent') ?? null;
    if (agent && !AGENT_ID.test(agent)) throw new HttpError(400, { error: 'bad agent id' });
    const offset = Math.max(0, Math.floor(Number(c.req.query('offset') ?? 0) || 0));
    const chunk = engine.agents.log(sid, agent, offset);
    if (!chunk) throw new HttpError(404, { error: 'no transcript for this session' });
    return c.json(chunk);
  });

  app.post('/api/agents/:sessionId/kill', (c) => {
    const sid = c.req.param('sessionId');
    if (!SESSION_ID.test(sid) && !FOUNDRY_ROW_ID.test(sid)) throw new HttpError(400, { error: 'bad session id' });
    // external sessions are never killable from here — they simply don't match a Foundry row
    const f = engine.foundryLiveSessions().find((s) => s.sessionId === sid || `foundry-${s.taskId}` === sid);
    if (!f) throw new HttpError(404, { error: 'not a live Foundry session' });
    if (!engine.killTaskSession(f.taskId)) throw new HttpError(409, { error: 'no live process for this session' });
    return c.json({ ok: true });
  });

  app.get('/api/goals', (c) => {
    const goals = listGoals(db).map((g) => {
      const tasks = listTasks(db, g.id);
      return { ...g, budget: budgetStatus(g), taskCounts: count(tasks.map((t) => t.state)), openEscalations: listEscalations(db, { goalId: g.id, openOnly: true }).length };
    });
    return c.json(goals);
  });

  app.post('/api/goals', async (c) => {
    const body = CreateGoalBody.parse(await c.req.json());
    const goal = await engine.createGoal(body);
    return c.json(goal, 201);
  });

  // upstream gap of a base branch (fetches remote-tracking refs only) and the one explicit way to move the local branch
  app.post('/api/repos/upstream', async (c) => {
    const { repoPath, branch } = z.object({ repoPath: z.string().min(1), branch: z.string().min(1) }).parse(await c.req.json());
    const s = await fetchBase(repoPath, branch);
    return c.json({ ...s, start: startRef(s, engine.config.sync.startFrom), fetchBeforeGoal: engine.config.sync.fetchBeforeGoal });
  });
  app.post('/api/repos/pull', async (c) => {
    const { repoPath, branch } = z.object({ repoPath: z.string().min(1), branch: z.string().min(1) }).parse(await c.req.json());
    const r = await pullFastForward(repoPath, branch);
    engine.store.append({ type: 'engine.note', goalId: null, payload: { level: r.ok ? 'info' : 'warn', message: `pull --ff-only ${branch} in ${repoPath}: ${r.detail}` } });
    return c.json(r, r.ok ? 200 : 409);
  });
  app.post('/api/validate-repo', async (c) => {
    const { repoPath } = z.object({ repoPath: z.string() }).parse(await c.req.json());
    const info = await inspectRepo(repoPath);
    const error = !info.exists ? 'path does not exist' : !info.isDir ? 'not a directory' : info.insideRepoAt ? `inside the repository at ${info.insideRepoAt}` : !info.isGitRepo ? 'not a git repository (you can initialize it)' : !info.hasCommits ? 'repository has no commits yet' : null;
    return c.json({ ...info, ok: info.isGitRepo && info.hasCommits, branch: info.branch ?? '', error });
  });
  // ---- attachments ----
  const parseUpload = async (c: any): Promise<{ files: { name: string; mime: string | null; bytes: Uint8Array }[]; link: { url: string; name?: string; note?: string } | null }> => {
    const ct = c.req.header('content-type') ?? '';
    if (ct.includes('multipart/form-data')) {
      const body = await c.req.parseBody({ all: true });
      const raw = body.file ?? body.files;
      const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((f: unknown): f is File => f instanceof File);
      const files = [];
      for (const f of list) files.push({ name: f.name, mime: f.type || null, bytes: new Uint8Array(await f.arrayBuffer()) });
      return { files, link: null };
    }
    const json = await c.req.json();
    const link = z.object({ url: z.string().min(1), name: z.string().optional(), note: z.string().optional() }).parse(json);
    return { files: [], link };
  };
  const attachmentError = (e: unknown) => {
    if (e instanceof AttachmentError) throw new HttpError(e.code === 'too-large' ? 413 : e.code === 'not-found' ? 404 : 400, { error: e.message, code: e.code });
    throw e;
  };
  /** Stage files (or register a link) before the goal exists; returns Attachment records to pass to POST /api/goals. */
  app.post('/api/uploads', async (c) => {
    try {
      const { files, link } = await parseUpload(c);
      if (link) return c.json({ attachments: [engine.stage(linkAttachment(link.url, { name: link.name, note: link.note }))] }, 201);
      if (!files.length) throw new HttpError(400, { error: 'no file field in the form' });
      return c.json({ attachments: files.map((f) => engine.stage(stageFile(engine.config.dataDir, f))) }, 201);
    } catch (e) {
      return attachmentError(e);
    }
  });
  // conversion status of a staged upload (before the goal exists)
  app.get('/api/uploads/:id', (c) => {
    const a = engine.stagedView(c.req.param('id'));
    if (!a) throw new HttpError(404, { error: 'not staged (claimed by a goal or expired)' });
    return c.json(a);
  });
  app.post('/api/goals/:id/attachments', async (c) => {
    try {
      const { files, link } = await parseUpload(c);
      // plan only; addAttachment starts the conversion after the file has moved into the goal directory
      const staged = link ? [engine.stage(linkAttachment(link.url, { name: link.name, note: link.note }), { convert: false })] : files.map((f) => engine.stage(stageFile(engine.config.dataDir, f), { convert: false }));
      return c.json({ attachments: staged.map((a) => engine.addAttachment(c.req.param('id'), a)) }, 201);
    } catch (e) {
      return attachmentError(e);
    }
  });
  app.post('/api/goals/:id/attachments/:attId/convert', async (c) => c.json({ markdown: await engine.reconvertAttachment(c.req.param('id'), c.req.param('attId')) }));
  // one-click tool installs (markitdown, catalog cli entries such as graphify) — stream to the `tool-install` live channel
  const toolInstall = async (c: any, id: string) => {
    const say = (line: string) => engine.broadcast({ goalId: '', taskId: null, attemptId: 'tool-install', event: { kind: 'text', text: line }, ts: new Date().toISOString() });
    void engine.installTool(id, say).catch((e) => say(`✘ ${String(e.message ?? e)}`));
    return c.json({ started: true, channel: 'tool-install', id }, 202);
  };
  app.post('/api/tools/markitdown/install', (c) => toolInstall(c, 'markitdown'));

  // ---- preview: the goal's run command in its progress folder (Goal page, milestones, integrations) ----
  const goalOr404 = (c: any) => {
    const goal = getGoal(db, c.req.param('id'));
    if (!goal) throw new HttpError(404, { error: 'goal not found' });
    return goal;
  };
  app.get('/api/goals/:id/preview', (c) => c.json(engine.preview.status(goalOr404(c).id)));
  app.post('/api/goals/:id/preview/start', async (c) => {
    const goal = goalOr404(c);
    try {
      return c.json(await engine.preview.start(goal, 'human'));
    } catch (e) {
      if (e instanceof PreviewError) throw new HttpError(e.status, { error: e.message });
      throw e;
    }
  });
  app.post('/api/goals/:id/preview/stop', async (c) => {
    await engine.preview.stop(goalOr404(c).id, 'human');
    return c.json({ ok: true });
  });
  app.post('/api/goals/:id/preview/visit', (c) => {
    engine.preview.touch(goalOr404(c).id);
    return c.json({ ok: true });
  });
  app.post('/api/goals/:id/selfcheck', async (c) => {
    const { on } = z.object({ on: z.boolean() }).parse(await c.req.json());
    engine.setSelfCheck(goalOr404(c).id, on);
    return c.json({ ok: true });
  });
  // ---- Clarify interview: the human answers a round; the session continues in the background ----
  app.post('/api/goals/:id/interview/answer', async (c) => {
    const goal = goalOr404(c);
    const body = z.object({ answers: z.record(z.string()).default({}), finish: z.boolean().default(false) }).parse(await c.req.json().catch(() => ({})));
    try {
      engine.answerInterview(goal.id, body.answers, body.finish);
    } catch (e) {
      throw new HttpError(409, { error: String((e as Error).message ?? e) });
    }
    return c.json({ ok: true });
  });
  // ---- milestone feedback: triage what the person wrote into a plan they confirm (the answer carries the plan) ----
  app.post('/api/goals/:id/feedback/classify', async (c) => {
    const goal = goalOr404(c);
    const { text } = z.object({ text: z.string().min(1) }).parse(await c.req.json());
    try {
      return c.json({ plan: await classifyFeedback(engine, goal, text) });
    } catch (e) {
      throw new HttpError(409, { error: String((e as Error).message ?? e) });
    }
  });
  // ---- what the self-check saw, and the goal's artifacts ----
  app.get('/api/goals/:id/screenshots', (c) => {
    const goal = goalOr404(c);
    const shots = engine.store
      .listByGoal(goal.id, 5000)
      .filter((e) => e.type === 'selfcheck.finished')
      .map((e) => ({ at: e.ts, ...(e.payload as { taskId: string | null; status: string; url: string | null; screenshot: string | null; errors: string[]; summary: string }) }))
      .reverse()
      .slice(0, 20);
    return c.json({ screenshots: shots });
  });
  app.get('/api/goals/:id/screenshots/:file', (c) => {
    const goal = goalOr404(c);
    const file = c.req.param('file');
    if (!/^[\w.-]+\.png$/.test(file)) throw new HttpError(400, { error: 'bad screenshot name' });
    const p = join(screenshotsDir(engine.config.dataDir, goal), file);
    if (!existsSync(p)) throw new HttpError(404, { error: 'screenshot not found' });
    return new Response(Bun.file(p), { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600' } });
  });
  app.get('/api/goals/:id/artifacts', (c) => c.json({ files: listArtifacts(goalWorkspacePath(engine.config.dataDir, goalOr404(c))) }));
  app.get('/api/goals/:id/artifacts/*', (c) => {
    const goal = goalOr404(c);
    const rel = decodeURIComponent(c.req.path.slice(c.req.path.indexOf('/artifacts/') + '/artifacts/'.length));
    if (!rel || rel.split('/').some((seg) => seg === '..' || seg === '' || seg.startsWith('.git'))) throw new HttpError(400, { error: 'bad artifact path' });
    const p = join(goalWorkspacePath(engine.config.dataDir, goal), 'artifacts', rel);
    if (!existsSync(p)) throw new HttpError(404, { error: 'artifact not found' });
    return new Response(Bun.file(p), { headers: { 'cache-control': 'private, max-age=60' } });
  });
  app.get('/api/tools/playwright', async (c) => c.json(await engine.playwrightStatus()));
  app.post('/api/tools/playwright/install', (c) => toolInstall(c, 'playwright'));
  app.post('/api/tools/install', async (c) => toolInstall(c, z.object({ id: z.string().min(1) }).parse(await c.req.json()).id));
  app.delete('/api/goals/:id/attachments/:attId', (c) => {
    engine.removeAttachment(c.req.param('id'), c.req.param('attId'));
    return c.json({ ok: true });
  });
  // The markdown rendition (markitdown output / link snapshot) as text, by id only.
  const mdResponse = (abs: string | null) => {
    if (!abs) throw new HttpError(404, { error: 'no markdown rendition for this attachment' });
    return new Response(Bun.file(abs), { headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'private, max-age=60', 'x-content-type-options': 'nosniff' } });
  };
  app.get('/api/goals/:id/attachments/:attId/markdown', (c) => {
    const goal = getGoal(db, c.req.param('id'));
    const att = goal?.attachments.find((a) => a.id === c.req.param('attId'));
    if (!goal || !att) throw new HttpError(404, { error: 'attachment not found' });
    return mdResponse(markdownAbsPath(engine.config.dataDir, goal.id, att));
  });
  app.get('/api/uploads/:id/markdown', (c) => {
    const a = engine.stagedView(c.req.param('id'));
    if (!a) throw new HttpError(404, { error: 'not staged (claimed by a goal or expired)' });
    return mdResponse(stagedMarkdownAbsPath(engine.config.dataDir, a));
  });
  // Serves the file by id only; the path comes from the stored record, never from the request.
  app.get('/api/goals/:id/attachments/:attId', (c) => {
    const goal = getGoal(db, c.req.param('id'));
    const att = goal?.attachments.find((a) => a.id === c.req.param('attId'));
    if (!goal || !att) throw new HttpError(404, { error: 'attachment not found' });
    if (att.kind === 'link') return c.redirect(att.url!, 302);
    const abs = attachmentAbsPath(engine.config.dataDir, goal.id, att);
    if (!abs) throw new HttpError(404, { error: 'attachment file is missing on disk' });
    const inline = c.req.query('download') !== '1';
    return new Response(Bun.file(abs), {
      headers: {
        'content-type': att.mime ?? 'application/octet-stream',
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(att.name)}`,
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff',
      },
    });
  });

  // ---- open in editor / file manager / terminal (paths resolved server-side, never from the request) ----
  app.get('/api/open/targets', (c) => c.json({ targets: detectOpenTargets() }));
  app.post('/api/goals/:id/open', async (c) => {
    const goal = getGoal(db, c.req.param('id'));
    if (!goal) throw new HttpError(404, { error: 'goal not found' });
    const body = z.object({ target: z.string(), which: z.string().default('repo') }).parse(await c.req.json());
    let path: string | null = null;
    if (body.which === 'repo') path = goal.repoPath;
    else if (body.which === 'workspace') path = goalWorkspacePath(engine.config.dataDir, goal);
    else if (body.which.startsWith('resolve:')) {
      const p = resolveWorkspacePath(engine.config.dataDir, goal, body.which.slice(8));
      path = existsSync(p) ? p : null;
    }
    else if (body.which.startsWith('task:')) path = listTasks(db, goal.id).find((t) => t.id === body.which.slice(5))?.worktreePath ?? null;
    if (!path) throw new HttpError(404, { error: `nothing to open for ${body.which}` });
    try {
      const r = await openPath(body.target as OpenTargetId, path);
      engine.store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `opened ${body.which} in ${body.target}: ${r.command.join(' ')}` } });
      return c.json({ ok: true, path, command: r.command });
    } catch (e) {
      if (e instanceof OpenError) throw new HttpError(e.code === 'unknown-target' || e.code === 'not-a-directory' ? 404 : 400, { error: e.message, code: e.code, path });
      throw e;
    }
  });

  // ---- folder browsing (read-only, confined to allowed roots) ----
  const roots = () => engine.config.allowedRoots ?? defaultAllowedRoots();
  app.get('/api/fs/list', (c) => {
    const path = c.req.query('path') || homedir();
    try {
      return c.json(listDirs(path, { roots: roots(), showHidden: c.req.query('hidden') === '1' }));
    } catch (e) {
      if (e instanceof BrowseError) throw new HttpError(e.code === 'forbidden' ? 403 : 404, { error: e.message, code: e.code });
      throw e;
    }
  });
  app.get('/api/fs/recent', (c) => {
    const seen = new Set<string>();
    const recent = listGoals(db)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((g) => g.repoPath)
      .filter((p) => !seen.has(p) && seen.add(p) && existsSync(p))
      .slice(0, 12);
    return c.json({ recent, roots: wellKnownRoots(), nativePicker: process.platform === 'darwin' });
  });
  app.post('/api/fs/pick', async (c) => {
    if (process.platform !== 'darwin') throw new HttpError(501, { error: 'native folder picker is only available on macOS' });
    const body = await c.req.json().catch(() => ({}));
    const r = await pickFolder({ defaultDir: typeof body?.defaultDir === 'string' ? body.defaultDir : undefined });
    return c.json(r);
  });
  app.post('/api/repos/init', async (c) => {
    const { path, branch } = z.object({ path: z.string().min(1), branch: z.string().optional() }).parse(await c.req.json());
    const r = await initRepo(path, { branch });
    engine.store.append({ type: 'engine.note', goalId: null, payload: { level: 'info', message: `git init ${path} (${r.branch}, ${r.filesCommitted} files, identity ${r.identity})` } });
    return c.json(r);
  });
  app.get('/api/github/status', async (c) => c.json(await engine.gh.available()));
  app.get('/api/github/orgs', async (c) => c.json(await engine.gh.orgs()));
  app.post('/api/github/auth/login', async (c) => {
    const a = await engine.gh.available();
    if (!a.installed) return c.json({ error: 'gh is not installed: brew install gh' }, 422);
    void engine.gh.login((line) => engine.broadcast({ goalId: '', taskId: null, attemptId: 'gh-auth', event: { kind: 'text', text: line }, ts: new Date().toISOString() })).then((r) => engine.broadcast({ goalId: '', taskId: null, attemptId: 'gh-auth', event: { kind: 'text', text: r.ok ? '✔ GitHub login complete' : `✘ GitHub login failed: ${r.output.slice(-200)}` }, ts: new Date().toISOString() }));
    return c.json({ started: true });
  });

  app.get('/api/goals/:id', (c) => {
    const id = c.req.param('id');
    const goal = getGoal(db, id);
    if (!goal) return c.json({ error: 'not found' }, 404);
    const tasks = listTasks(db, id);
    const depth = safeDepths(tasks);
    const ws = goalWorkspacePath(engine.config.dataDir, goal);
    return c.json({
      goal,
      paths: { repo: goal.repoPath, workspace: existsSync(ws) ? ws : null },
      budget: budgetStatus(goal),
      tasks: tasks.map((t) => ({ ...t, depth: depth.get(t.id) ?? 0, usage: taskUsage(listAttempts(db, t.id)) })),
      attempts: listAttemptsByGoal(db, id),
      checks: listChecks(db, id),
      checkResults: listCheckResultsByGoal(db, id),
      brief: getBrief(db, id),
      escalations: listEscalations(db, { goalId: id }),
      events: engine.store.listByGoal(id, 300),
    });
  });

  app.patch('/api/goals/:id/brief', async (c) => {
    const body = Brief.parse({ ...(await c.req.json()), goalId: c.req.param('id') });
    return c.json(engine.editBrief(c.req.param('id'), body));
  });

  app.post('/api/goals/:id/brief/draft', async (c) => {
    const parsed = DraftRequest.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
    return c.json({ proposal: await engine.draftBrief(c.req.param('id'), parsed.data) });
  });

  // manual merge resolution (a task blocked on a merge conflict)
  app.get('/api/goals/:id/tasks/:taskId/resolve', async (c) => {
    const { id, taskId } = c.req.param();
    const can = canResolve(engine, id, taskId);
    let state = null;
    try {
      state = await describeResolution(engine, id, taskId);
    } catch {
      state = null;
    }
    return c.json({ can, state });
  });
  app.post('/api/goals/:id/tasks/:taskId/resolve/start', async (c) => {
    const { id, taskId } = c.req.param();
    const body = await c.req.json().catch(() => ({}));
    return c.json(await startResolution(engine, id, taskId, { fresh: body?.fresh === true }));
  });
  app.put('/api/goals/:id/tasks/:taskId/resolve/file', async (c) => {
    const { id, taskId } = c.req.param();
    const body = await c.req.json();
    if (typeof body?.path !== 'string' || typeof body?.content !== 'string') return c.json({ error: 'path and content required' }, 400);
    return c.json(await resolveFile(engine, id, taskId, body.path, body.content));
  });
  app.post('/api/goals/:id/tasks/:taskId/resolve/take', async (c) => {
    const { id, taskId } = c.req.param();
    const body = await c.req.json();
    if (typeof body?.path !== 'string' || !['ours', 'theirs', 'both'].includes(body?.side)) return c.json({ error: 'path and side (ours|theirs|both) required' }, 400);
    return c.json(await takeSide(engine, id, taskId, body.path, body.side));
  });
  app.post('/api/goals/:id/tasks/:taskId/resolve/unresolve', async (c) => {
    const { id, taskId } = c.req.param();
    const body = await c.req.json();
    if (typeof body?.path !== 'string') return c.json({ error: 'path required' }, 400);
    return c.json(await unresolveFile(engine, id, taskId, body.path));
  });
  app.post('/api/goals/:id/tasks/:taskId/resolve/finish', async (c) => {
    const { id, taskId } = c.req.param();
    const body = await c.req.json().catch(() => ({}));
    return c.json(await finishResolution(engine, id, taskId, { force: body?.force === true }));
  });
  app.post('/api/goals/:id/tasks/:taskId/resolve/abort', async (c) => {
    const { id, taskId } = c.req.param();
    await abortResolution(engine, id, taskId);
    return c.json({ ok: true });
  });

  // style samples: start one generation (result arrives as brief.style_sampled), fetch a generated file
  app.post('/api/goals/:id/brief/style-sample', async (c) => {
    const { styleKey } = z.object({ styleKey: z.string().min(1).max(40) }).parse(await c.req.json());
    try {
      return c.json({ started: true, ...startStyleSample(engine, c.req.param('id'), styleKey) }, 202);
    } catch (e) {
      if (e instanceof StyleSampleError) throw new HttpError(e.status, { error: e.message });
      throw e;
    }
  });
  app.get('/api/goals/:id/brief/style-sample/:file', async (c) => {
    const file = c.req.param('file');
    if (!/^[\w.-]+\.png$/.test(file)) throw new HttpError(400, { error: 'bad sample file name' });
    const goal = getGoal(db, c.req.param('id'));
    if (!goal) throw new HttpError(404, { error: 'goal not found' });
    const p = join(goalWorkspacePath(engine.config.dataDir, goal), 'artifacts', 'samples', file);
    if (!existsSync(p)) throw new HttpError(404, { error: 'sample not generated yet' });
    return new Response(Bun.file(p), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' } });
  });

  app.post('/api/goals/:id/reclarify', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    await engine.reclarify(c.req.param('id'), typeof body?.reason === 'string' && body.reason ? body.reason : 'requested by user');
    return c.json({ ok: true });
  });
  app.post('/api/goals/:id/brief/approve', async (c) => {
    // body: the (possibly edited) Brief, optionally with `budgets` / `completion` alongside (Brief.parse strips unknown keys)
    const raw = await c.req.text();
    const json = raw ? JSON.parse(raw) : null;
    const brief = json && json.understanding !== undefined ? Brief.parse({ ...json, goalId: c.req.param('id') }) : undefined;
    const budgets = json?.budgets ? BudgetsBody.parse(json.budgets) : undefined;
    const completion = json?.completion ? CompletionBody.parse(json.completion) : undefined;
    await engine.approveBrief(c.req.param('id'), brief, budgets, completion);
    return c.json({ ok: true });
  });

  app.post('/api/goals/:id/cancel', (c) => {
    engine.cancelGoal(c.req.param('id'));
    return c.json({ ok: true });
  });
  app.post('/api/goals/:id/restart', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json(await engine.restartGoal(c.req.param('id'), { fromTaskId: typeof body?.fromTaskId === 'string' ? body.fromTaskId : undefined }));
  });
  app.delete('/api/goals/:id', async (c) => c.json({ ok: true, ...(await engine.deleteGoal(c.req.param('id'), { deleteBranch: c.req.query('deleteBranch') === '1' })) }));

  app.get('/api/goals/:id/diff', async (c) => {
    const goal = getGoal(db, c.req.param('id'));
    if (!goal) return c.json({ error: 'not found' }, 404);
    const ws = goalWorkspacePath(engine.config.dataDir, goal);
    if (!existsSync(ws)) return c.text('');
    return c.text(await gitDiff(ws, goal.baseBranch, 'HEAD', 500_000));
  });

  app.post('/api/goals/:id/push', async (c) => {
    // human-clicked push = delivery policy "push" (same audited helper, never force)
    const { remote } = z.object({ remote: z.string().default('origin') }).parse(await c.req.json().catch(() => ({})));
    const g = await engine.deliver(c.req.param('id'), { mode: 'push', remote });
    return c.json({ ok: true, delivery: g.delivery });
  });
  app.post('/api/goals/:id/deliver', async (c) => {
    const policy = DeliveryPolicy.partial().parse(await c.req.json().catch(() => ({})));
    const g = await engine.deliver(c.req.param('id'), policy);
    return c.json({ ok: true, delivery: g.delivery });
  });
  app.get('/api/goals/:id/delivery/plan', async (c) => {
    const q = c.req.query();
    const policy: Record<string, unknown> = {};
    if (q.mode) policy.mode = q.mode;
    if (q.remote) policy.remote = q.remote;
    if (q.remoteUrl) policy.remoteUrl = q.remoteUrl;
    if (q.owner && q.name) policy.createRepo = { owner: q.owner, name: q.name, visibility: q.visibility ?? 'private' };
    if (q.mergeMethod) policy.mergeMethod = q.mergeMethod;
    if (q.unit) policy.unit = q.unit;
    return c.json(await engine.deliveryPlan(c.req.param('id'), DeliveryPolicy.partial().parse(policy)));
  });
  app.post('/api/goals/:id/delivery/cancel', (c) => c.json({ ok: engine.cancelDelivery(c.req.param('id')) }));

  /**
   * Decoded history of a live channel (attempt id, or pseudo ids such as clarify-<goal>, goal-review-<goal>-<n>),
   * so the Live log survives a page refresh. Last 400 events, slimmed like the WebSocket feed.
   */
  app.get('/api/stream/:id/history', async (c) => {
    const id = c.req.param('id');
    const a = getAttempt(db, id);
    let path = a?.transcriptPath ?? null;
    if (!path && /^[\w.-]+$/.test(id)) path = join(engine.config.dataDir, 'transcripts', `${id}.jsonl`);
    if (!path || !existsSync(path)) return c.json({ events: [] });
    const text = await Bun.file(path).text();
    const events: unknown[] = [];
    for (const line of text.split('\n')) {
      for (const ev of decodeLine(line)) {
        if (ev.kind === 'unknown' || ev.kind === 'stderr') continue;
        events.push(ev.kind === 'thinking' ? { kind: 'thinking', text: ev.text.slice(0, 300) } : ev.kind === 'tool_result' ? { ...ev, content: ev.content.slice(0, 1500) } : ev);
      }
    }
    return c.json({ events: events.slice(-400) });
  });
  /** What the goal's work looks like right now: worktree path, branch, and how to try it. */
  app.get('/api/goals/:id/workspace', async (c) => {
    const goal = getGoal(db, c.req.param('id'));
    if (!goal) throw new HttpError(404, { error: 'goal not found' });
    const path = goalWorkspacePath(engine.config.dataDir, goal);
    const exists = existsSync(path);
    let head: string | null = null;
    let scripts: Record<string, string> = {};
    let pm: 'bun' | 'pnpm' | 'yarn' | 'npm' | null = null;
    if (exists) {
      head = (await exec(['git', 'log', '-1', '--format=%h %s'], path).catch(() => ({ code: 1, stdout: '', stderr: '' }))).stdout.trim() || null;
      try {
        const pkg = JSON.parse(await Bun.file(join(path, 'package.json')).text());
        scripts = pkg.scripts ?? {};
        pm = existsSync(join(path, 'bun.lock')) || existsSync(join(path, 'bun.lockb')) ? 'bun' : existsSync(join(path, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(join(path, 'yarn.lock')) ? 'yarn' : 'npm';
      } catch {}
    }
    const run = (s: string) => (pm === 'bun' ? `bun run ${s}` : pm === 'pnpm' ? `pnpm ${s}` : pm === 'yarn' ? `yarn ${s}` : `npm run ${s}`);
    const install = pm === 'bun' ? 'bun install' : pm === 'pnpm' ? 'pnpm install' : pm === 'yarn' ? 'yarn' : pm ? 'npm install' : null;
    const suggested = ['dev', 'start', 'test', 'build'].filter((s) => scripts[s]).map((s) => ({ name: s, command: run(s) }));
    // current local-vs-remote gap of the base branch without a network round trip (remote-tracking refs as last fetched)
    const upstream = await fetchBase(goal.repoPath, goal.baseBranch, { fetch: false }).catch(() => null);
    return c.json({ path, exists, branch: goal.branch, head, packageManager: pm, install, scripts: suggested, baseSync: goal.baseSync, upstream, tasks: listTasks(db, goal.id).filter((t) => t.worktreePath).map((t) => ({ id: t.id, title: t.title, path: t.worktreePath, branch: t.branch })) });
  });
  app.get('/api/attempts/:id/transcript', async (c) => {
    const a = getAttempt(db, c.req.param('id'));
    if (!a?.transcriptPath || !existsSync(a.transcriptPath)) return c.text('');
    return c.text(await Bun.file(a.transcriptPath).text());
  });

  app.get('/api/attempts/:id/prompt', async (c) => {
    const a = getAttempt(db, c.req.param('id'));
    const p = a?.transcriptPath?.replace(/\.jsonl$/, '.prompt.md');
    if (!p || !existsSync(p)) return c.text('');
    return c.text(await Bun.file(p).text());
  });

  // every escalation names its goal and task so the Inbox can say *what* needs you, not just that something does
  app.get('/api/escalations', (c) =>
    c.json(
      listEscalations(db, { openOnly: c.req.query('open') === '1' }).map((e) => {
        const t = e.taskId ? listTasks(db, e.goalId).find((x) => x.id === e.taskId) : null;
        return { ...e, goalTitle: getGoal(db, e.goalId)?.title ?? e.goalId, taskTitle: t?.title ?? null, taskState: t?.state ?? null };
      }),
    ),
  );

  // the AI reads the task, the failure and the last session and proposes what to do; `apply` answers retry_with_hint on the spot
  app.post('/api/escalations/:id/suggest', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const suggestion = await engine.suggestForEscalation(c.req.param('id'));
    let applied = false;
    if (body?.apply === true && suggestion.action === 'retry_with_hint') {
      await engine.answerEscalation(c.req.param('id'), { action: 'retry_with_hint', hint: suggestion.hint, extraAttempts: 1 });
      applied = true;
    }
    return c.json({ suggestion, applied });
  });

  app.post('/api/escalations/:id/answer', async (c) => {
    const answer = EscalationAnswer.parse(await c.req.json());
    await engine.answerEscalation(c.req.param('id'), answer);
    return c.json({ ok: true });
  });

  // ---------- skills & setup ----------
  app.get('/api/skills', async (c) => c.json(await engine.skills.overview(c.req.query('repo') || undefined)));
  app.get('/api/skills/trash', (c) => c.json(engine.skills.trash()));
  // Grouped-by-source update report. ?refresh=1 starts an upstream fetch in the background and returns the
  // current (possibly stale) report with refreshing=true; the page polls until it flips back. Fetches can take minutes.
  app.get('/api/skills/updates', async (c) => {
    const refresh = c.req.query('refresh') === '1';
    const repoPath = c.req.query('repo') || undefined;
    const meta = () => ({ updating: engine.skills.updatingSource(), refreshing: engine.skills.refreshing() });
    if (refresh || (!engine.skills.cachedUpdates() && !engine.skills.refreshing())) {
      void engine.skills.updates({ refresh: true, repoPath }).catch((e) => engine.config.log(`[skills] update check failed: ${e}`));
    }
    const cached = engine.skills.cachedUpdates();
    if (cached) return c.json({ ...cached, ...meta() });
    // nothing cached yet: give the offline (filesystem-only) view right away
    const offline = await engine.skills.updates({ offline: true, repoPath });
    return c.json({ ...offline, stale: true, ...meta() });
  });
  const stream = (channel: string) => (line: string) => engine.broadcast({ goalId: '', taskId: null, attemptId: channel, event: { kind: 'text', text: line }, ts: new Date().toISOString() });
  app.post('/api/skills/sources/:id/update', async (c) => {
    const id = decodeURIComponent(c.req.param('id'));
    const body = await c.req.json().catch(() => ({}));
    const names: string[] | undefined = Array.isArray(body?.names) ? body.names.map(String) : undefined;
    if (engine.skills.updatingSource()) throw new HttpError(409, { error: `update of ${engine.skills.updatingSource()} is still running` });
    // runs in the background; the UI follows the `skills-update` live channel and re-fetches /api/skills/updates when it ends
    void engine.skills
      .updateSource(id, { names, onLine: stream('skills-update') })
      .then((run) => stream('skills-update')(run.error ? `✘ ${run.error}` : `✔ finished`))
      .catch((e) => stream('skills-update')(`✘ ${String(e.message ?? e)}`));
    return c.json({ started: true, channel: 'skills-update' }, 202);
  });
  app.post('/api/skills/adopt', async (c) => {
    const { names } = z.object({ names: z.array(z.string()).min(1) }).parse(await c.req.json());
    return c.json({ runs: await engine.skills.adopt(names, stream('skills-update')) });
  });
  app.post('/api/skills/cleanup-shadows', async (c) => {
    const { names } = z.object({ names: z.array(z.string()).min(1) }).parse(await c.req.json());
    return c.json(await engine.skills.cleanupShadows(names));
  });
  app.get('/api/skills/update-runs', (c) => c.json(engine.store.listByType('skills.update_run', 50)));
  app.get('/api/skills/view', (c) => {
    const v = engine.skills.viewSkill(c.req.query('dir') ?? '');
    if (!v) throw new HttpError(404, { error: 'skill not found in the current scan' });
    return c.json(v);
  });
  app.post('/api/skills/uninstall-many', async (c) => {
    const { names, force } = z.object({ names: z.array(z.string()).min(1), force: z.boolean().optional() }).parse(await c.req.json());
    return c.json(await engine.skills.uninstallMany(names, { force }));
  });
  app.post('/api/skills/install-bundle', async (c) => {
    const { bundle } = z.object({ bundle: z.string().min(1) }).parse(await c.req.json());
    return c.json(await engine.skills.installBundle(bundle));
  });
  // mutually exclusive packs (design / image / video skills): options + install status, and a streamed one-click install
  app.get('/api/skills/packs', async (c) => {
    const statuses = await engine.skills.status();
    const view = (pack: string, opts: typeof DESIGN_PACK_OPTIONS, chosen: string) => ({
      chosen,
      options: opts.map((o) => ({
        ...o,
        entries: statuses.filter((s) => s.entry.pack === pack && s.entry.packOption === o.id).map((s) => ({ id: s.entry.id, name: s.entry.name, invoke: s.entry.invoke ?? s.installedInvoke ?? `/${s.entry.name}`, status: s.status, detail: s.detail, manual: s.manual, sourceType: s.entry.source.type })),
      })),
    });
    return c.json({
      design: view('design', DESIGN_PACK_OPTIONS, engine.config.designPack),
      image: view('image', IMAGE_PACK_OPTIONS, engine.config.imagePack),
      video: view('video', VIDEO_PACK_OPTIONS, engine.config.videoPack),
    });
  });
  app.post('/api/skills/install-pack', async (c) => {
    const { pack, option } = z.object({ pack: z.string().min(1), option: z.string().min(1) }).parse(await c.req.json());
    const channel = 'tool-install';
    const line = (text: string) => engine.broadcast({ goalId: '', taskId: null, attemptId: channel, event: { kind: 'text', text }, ts: new Date().toISOString() });
    void engine.skills
      .installPack(pack, option, line)
      .then((r) => r.results.forEach((x) => line(`${x.action}: ${x.name} — ${x.detail}`)))
      .catch((e) => line(`error: ${String((e as Error).message ?? e)}`));
    return c.json({ started: true, channel, pack, option });
  });

  // ---------- models ----------
  app.get('/api/models', (c) => c.json({ models: engine.listModels(), fallbacks: engine.config.modelFallbacks, current: engine.config.models }));
  app.post('/api/models/probe', async (c) => {
    const { name } = z.object({ name: z.string().min(1).max(80) }).parse(await c.req.json());
    return c.json(await engine.probeModel(name));
  });

  // ---------- settings ----------
  app.get('/api/settings', (c) => c.json(engine.settingsView()));
  app.put('/api/settings', async (c) => {
    const parsed = SettingsPatch.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
    try {
      return c.json(engine.updateSettings(parsed.data));
    } catch (e) {
      if (e instanceof SettingsError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });
  app.delete('/api/settings/:path', (c) => {
    try {
      return c.json(engine.resetSettings(c.req.param('path')));
    } catch (e) {
      if (e instanceof SettingsError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });
  app.post('/api/settings/reset', (c) => c.json(engine.resetSettings()));
  // ---------- notifications (test / telegram chat-id detection use the draft credentials, saved ones as fallback) ----------
  app.post('/api/notifications/test', async (c) => {
    const override = NotificationSettings.partial().parse(await c.req.json().catch(() => ({})));
    return c.json({ results: await engine.notifications.test(override) });
  });
  app.post('/api/notifications/telegram/chat-id', async (c) => {
    const { token } = z.object({ token: z.string().min(1).nullable().optional() }).parse(await c.req.json().catch(() => ({})));
    const t = token ?? engine.settings.values().notifications.telegramBotToken;
    if (!t) return c.json({ error: 'no bot token — paste the token from @BotFather first' }, 400);
    return c.json(await detectTelegramChatId(t));
  });
  // ---------- version & self-update (ADR-0010): cached report like /api/skills/updates; apply streams to `self-update` ----------
  app.get('/api/update', (c) => c.json({ ...engine.updater.reportOrKick(), capability: engine.updater.capability(), checking: engine.updater.isChecking(), applying: engine.updater.isApplying() }));
  app.post('/api/update/check', async (c) => c.json(await engine.updater.check()));
  app.post('/api/update/apply', async (c) => {
    const { force } = z.object({ force: z.boolean().optional() }).parse(await c.req.json().catch(() => ({})));
    const cap = engine.updater.capability();
    if (engine.updater.isApplying()) throw new HttpError(409, { error: 'an update is already running' });
    if (!cap.canSelfUpdate) throw new HttpError(422, { error: 'this install cannot self-update', guided: cap.guided, mode: cap.mode });
    if (!engine.updater.cachedReport()?.updateAvailable) throw new HttpError(409, { error: 'no newer version known — check for updates first' });
    // background; failures are streamed to the channel and recorded as an update.run event
    void engine.updater.apply({ force, onLine: stream('self-update') }).catch(() => {});
    return c.json({ started: true, channel: 'self-update' }, 202);
  });

  app.post('/api/skills/install', async (c) => {
    const { id, force } = z.object({ id: z.string(), force: z.boolean().optional() }).parse(await c.req.json());
    const r = await engine.skills.install(id, { force });
    if (r.manual) return c.json({ error: r.error, manual: r.manual, id: r.id, name: r.name }, 422);
    return c.json(r);
  });
  app.post('/api/skills/install-tier', async (c) => {
    const { tiers } = z.object({ tiers: z.array(z.enum(['required', 'recommended', 'optional'])).min(1) }).parse(await c.req.json());
    return c.json(await engine.skills.installTier(tiers));
  });
  app.post('/api/skills/update', async (c) => {
    const { name } = z.object({ name: z.string().optional() }).parse(await c.req.json().catch(() => ({})));
    return c.json(await engine.skills.update(name));
  });
  app.post('/api/skills/:name/uninstall', async (c) => {
    const { force } = z.object({ force: z.boolean().optional() }).parse(await c.req.json().catch(() => ({})));
    return c.json({ ok: true, ...(await engine.skills.uninstall(c.req.param('name'), { force })) });
  });
  app.post('/api/skills/:name/restore', async (c) => {
    const { force, trashPath } = z.object({ force: z.boolean().optional(), trashPath: z.string().optional() }).parse(await c.req.json().catch(() => ({})));
    return c.json({ ok: true, ...(await engine.skills.restore(c.req.param('name'), { force, trashPath })) });
  });
  app.get('/api/doctor', async (c) => c.json(await engine.doctor()));
  // ---------- claude account ----------
  app.get('/api/auth', async (c) => c.json({ status: await engine.auth.status(c.req.query('force') === '1'), login: engine.auth.loginSession() }));
  app.post('/api/auth/login', async (c) => {
    const body = z.object({ mode: z.enum(['claudeai', 'console']).optional(), email: z.string().optional() }).parse(await c.req.json().catch(() => ({})));
    return c.json(engine.auth.startLogin(body));
  });
  app.get('/api/auth/login', (c) => c.json(engine.auth.loginSession()));
  // headless machines (Docker, a remote host): the CLI shows a code in the browser and waits for it here
  app.post('/api/auth/login/code', async (c) => {
    const { code } = z.object({ code: z.string().min(1) }).parse(await c.req.json());
    return c.json(engine.auth.submitCode(code));
  });
  app.post('/api/auth/login/cancel', (c) => {
    engine.auth.cancelLogin();
    return c.json({ ok: true });
  });
  app.post('/api/auth/logout', async (c) => c.json(await engine.auth.logout()));

  app.get('/api/usage', (c) => c.json(engine.usage()));
  app.post('/api/usage/probe', async (c) => c.json(await engine.probeUsage()));

  app.post('/internal/boundary', async (c) => {
    const payload = await c.req.json().catch(() => ({}));
    engine.handleBoundaryCallback(c.req.header('x-foundry-attempt') || null, payload);
    return c.json({ ok: true });
  });

  // static web UI
  const dist = opts.webDist;
  if (dist && existsSync(dist)) {
    app.get('*', async (c) => {
      const p = new URL(c.req.url).pathname;
      // hashed assets may be cached forever; index.html must be revalidated or the browser keeps an old bundle after a rebuild
      const file = Bun.file(join(dist, p === '/' ? 'index.html' : p));
      if (p !== '/' && (await file.exists())) return new Response(file, { headers: p.startsWith('/assets/') ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : { 'Cache-Control': 'no-cache' } });
      return new Response(Bun.file(join(dist, 'index.html')), { headers: { 'Cache-Control': 'no-cache' } });
    });
  } else {
    app.get('/', (c) => c.text('Foundry server. Web UI not built: run `bun run web:build`. API at /api/*'));
  }
  return app;
}

function count(xs: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}
function safeDepths(tasks: { id: string; dependsOn: string[] }[]) {
  try {
    return depths(tasks);
  } catch {
    return new Map<string, number>();
  }
}
