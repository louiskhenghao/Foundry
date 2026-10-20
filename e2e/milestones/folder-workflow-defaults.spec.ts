import { expect, test, type APIResponse, type Page } from '@playwright/test';

test.beforeEach(async ({ request }) => { expect((await request.post('/api/__fixture/reset')).ok()).toBe(true); });

const suite = (page: Page) => page.getByRole('radiogroup', { name: 'Workflow suite', exact: true });
const tdd = (page: Page) => page.getByRole('radiogroup', { name: 'Engineering discipline — TDD', exact: true });
const ponytail = (page: Page) => page.getByRole('checkbox', { name: /Ponytail —/ });
const note = (page: Page) => page.getByText(/^from the last goal in this folder:/);
async function caption(page: Page, text: string) {
  await suite(page).scrollIntoViewIfNeeded();
  await test.info().attach(text, { body: await page.screenshot(), contentType: 'image/png' });
}
async function selectFolder(page: Page, path: string) {
  const edit = page.getByRole('button', { name: 'edit path', exact: true });
  if (await edit.isVisible()) await edit.click();
  const input = page.getByPlaceholder('or type a path: /Users/you/projects/my-app');
  await input.fill(path);
  await input.press('Enter');
}

test('fixture reset restores invalid and empty folders and the original folder workflow after initialization and pull', async ({ request }) => {
  const fixture = await (await request.get('/api/__fixture')).json();
  async function body(response: APIResponse, caption: string) {
    expect(response.ok()).toBe(true);
    const value = await response.json();
    await test.info().attach(caption, { body: JSON.stringify(value, null, 2), contentType: 'application/json' });
    return value;
  }
  const validate = async (repoPath: string) => body(await request.post('/api/validate-repo', { data: { repoPath } }), 'POST /api/validate-repo → 200');
  expect(await validate(fixture.invalid)).toMatchObject({ ok: false, lastGoal: { title: 'Before git initialization' } });
  await body(await request.post('/api/repos/init', { data: { path: fixture.invalid } }), 'POST /api/repos/init → 200');
  expect(await validate(fixture.invalid)).toMatchObject({ ok: true, lastGoal: { title: 'Before git initialization' } });
  await body(await request.post('/api/__fixture/newer'), 'POST /api/__fixture/newer → 200');
  expect(await validate(fixture.repo)).toMatchObject({ ok: true, lastGoal: { title: 'Refreshed folder goal' } });
  await body(await request.post('/api/repos/pull', { data: { repoPath: fixture.repo, branch: 'main' } }), 'POST /api/repos/pull → 200');
  await body(await request.post('/api/__fixture/reset'), 'POST /api/__fixture/reset → 200');
  expect(await validate(fixture.invalid)).toMatchObject({ ok: false, lastGoal: { title: 'Before git initialization' } });
  expect(await validate(fixture.empty)).toMatchObject({ ok: true, lastGoal: null });
  expect(await validate(fixture.repo)).toMatchObject({ ok: true, commitCount: 1, lastGoal: { title: 'Latest <folder> goal' } });
  expect(await body(await request.post('/api/repos/upstream', { data: { repoPath: fixture.repo, branch: 'main' } }), 'POST /api/repos/upstream → 200')).toMatchObject({ ahead: 0, behind: 0 });
});

test('folder inheritance, individual overrides, pending/invalid/empty states and actual Expert submission', async ({ page, request }) => {
  const fixture = await (await request.get('/api/__fixture')).json();
  await page.goto('/goals/new');
  await expect(suite(page).getByRole('radio', { name: 'mattpocock', exact: true })).toBeChecked();
  await caption(page, 'Expert starts from Settings before a folder is selected');
  await selectFolder(page, fixture.repo);
  await expect(note(page)).toHaveText('from the last goal in this folder: Latest <folder> goal');
  await expect(suite(page).getByRole('radio', { name: 'pstack', exact: true })).toBeChecked();
  await expect(tdd(page).getByRole('radio', { name: 'off', exact: true })).toBeChecked();
  await expect(ponytail(page)).not.toBeChecked();
  await expect(page.getByText('pstack is not installed:', { exact: false })).toBeVisible();
  await caption(page, 'Ready folder inherits pstack, TDD off and Ponytail off; the title is escaped text');
  await tdd(page).getByRole('radio', { name: 'required', exact: true }).click();
  await expect(note(page)).toBeVisible();
  await caption(page, 'TDD was manually overridden; the source remains for suite and Ponytail');

  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/validate-repo', async (route) => { await pending; await route.continue(); });
  await selectFolder(page, fixture.invalid);
  await expect(note(page)).toHaveCount(0);
  await expect(suite(page).getByRole('radio', { name: 'mattpocock', exact: true })).toBeChecked();
  await expect(ponytail(page)).toBeChecked();
  await caption(page, 'Pending folder validation immediately restores untouched Settings choices and hides provenance');
  release();
  await expect(page.getByText('not a git repository (you can initialize it)', { exact: false })).toBeVisible();
  await page.unroute('**/api/validate-repo');
  await caption(page, 'Invalid folder keeps the manual TDD choice, defaults and no source note');
  await selectFolder(page, fixture.empty);
  await expect(page.getByText('Git repository', { exact: false }).first()).toBeVisible();
  await expect(note(page)).toHaveCount(0);
  await caption(page, 'A ready folder with no goals uses Settings defaults');

  await selectFolder(page, fixture.repo);
  await expect(note(page)).toBeVisible();
  await suite(page).getByRole('radio', { name: 'plain', exact: true }).click();
  await expect(note(page)).toBeVisible();
  await ponytail(page).check();
  await expect(note(page)).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 812 });
  await caption(page, 'Phone width: all three manual choices remove the folder source note');
  await page.getByPlaceholder('Describe the goal as you would to a senior engineer.', { exact: false }).fill('Verify the inherited workflow submission');
  const submitted = page.waitForResponse((r) => r.url().endsWith('/api/goals') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create & clarify', exact: true }).click();
  const response = await submitted;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON().workflow).toEqual({ pace: 'thorough', profile: 'plain', tdd: 'required', ponytail: 'on' });
  await test.info().attach('Expert POST /api/goals → 201 with protected workflow', { body: JSON.stringify(await response.json(), null, 2), contentType: 'application/json' });
});

test('Follow-up from a goal page wins; the Follows picker only links', async ({ page, request }) => {
  const fixture = await (await request.get('/api/__fixture')).json();
  await page.goto('/goals/new');
  await selectFolder(page, fixture.repo);
  await expect(note(page)).toHaveText('from the last goal in this folder: Latest <folder> goal');
  await page.getByRole('combobox', { name: 'Follows', exact: true }).selectOption(fixture.older);
  await expect(page.getByText('Follows: Earlier Follow-up', { exact: true })).toBeVisible();
  await expect(suite(page).getByRole('radio', { name: 'pstack', exact: true })).toBeChecked();
  await expect(tdd(page).getByRole('radio', { name: 'off', exact: true })).toBeChecked();
  await expect(ponytail(page)).not.toBeChecked();
  await caption(page, 'Follows picker adds a link while retaining the folder workflow');
  let release!: () => void;
  let fetched!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fetchedGate = new Promise<void>((resolve) => { fetched = resolve; });
  await page.route('**/api/validate-repo', async (route) => {
    if (route.request().postDataJSON().repoPath !== fixture.repo) return route.continue();
    const response = await route.fetch();
    fetched();
    await gate;
    await route.fulfill({ response });
  });
  await page.goto(`/goals/new?follows=${fixture.older}`);
  await fetchedGate;
  await expect(suite(page).getByRole('radio', { name: 'plain', exact: true })).toBeChecked();
  await expect(tdd(page).getByRole('radio', { name: 'preferred', exact: true })).toBeChecked();
  await expect(ponytail(page)).toBeChecked();
  await expect(note(page)).toHaveCount(0);
  await caption(page, 'A goal-page Follow-up takes suite, TDD and Ponytail from the chosen earlier goal');
  await selectFolder(page, fixture.invalid);
  await expect(page.getByText('not a git repository (you can initialize it)', { exact: false })).toBeVisible();
  const stale = page.waitForResponse((r) => r.url().endsWith('/api/validate-repo') && r.request().postDataJSON().repoPath === fixture.repo);
  release();
  await (await stale).finished();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.getByText('not a git repository (you can initialize it)', { exact: false })).toBeVisible();
  await expect(note(page)).toHaveCount(0);
});

for (const view of ['Simple', 'Fast'] as const) {
  test(`${view} preserves the existing TDD submission rule`, async ({ page, request }) => {
    const fixture = await (await request.get('/api/__fixture')).json();
    await page.goto('/goals/new');
    await selectFolder(page, fixture.repo);
    await expect(tdd(page).getByRole('radio', { name: 'off', exact: true })).toBeChecked();
    if (view === 'Simple') await page.getByRole('button', { name: /^Simple/ }).click();
    else await page.getByRole('checkbox', { name: /^Fast mode/ }).check();
    await page.getByPlaceholder('Describe the goal as you would to a senior engineer.', { exact: false }).fill(`Verify ${view} TDD submission`);
    const submitted = page.waitForResponse((r) => r.url().endsWith('/api/goals') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create & clarify', exact: true }).click();
    const response = await submitted;
    expect(response.status()).toBe(201);
    const body = response.request().postDataJSON();
    expect(body.workflow.profile).toBe('pstack');
    expect(body.workflow.ponytail).toBe('off');
    if (view === 'Simple') expect(body.workflow.tdd).toBe('preferred');
    else expect(body.workflow).not.toHaveProperty('tdd');
    const saved = await response.json();
    expect(saved.workflow.tdd).toBe(view === 'Simple' ? 'preferred' : 'off');
    await test.info().attach(`${view} POST /api/goals → 201 preserves TDD semantics`, { body: JSON.stringify(saved, null, 2), contentType: 'application/json' });
  });
}

test('late Settings and failed validation cannot replace winning or protected fields', async ({ page, request }) => {
  const fixture = await (await request.get('/api/__fixture')).json();
  let release!: () => void;
  const settingsGate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/settings', async (route) => { const response = await route.fetch(); await settingsGate; await route.fulfill({ response }); });
  await page.goto('/goals/new');
  await selectFolder(page, fixture.repo);
  await expect(note(page)).toBeVisible();
  const settingsResponse = page.waitForResponse((r) => r.url().endsWith('/api/settings'));
  release();
  await (await settingsResponse).finished();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(suite(page).getByRole('radio', { name: 'pstack', exact: true })).toBeChecked();
  await expect(tdd(page).getByRole('radio', { name: 'off', exact: true })).toBeChecked();
  await ponytail(page).check();
  await page.route('**/api/validate-repo', (route) => route.abort('failed'));
  await selectFolder(page, fixture.empty);
  await expect(note(page)).toHaveCount(0);
  await expect(suite(page).getByRole('radio', { name: 'mattpocock', exact: true })).toBeChecked();
  await expect(tdd(page).getByRole('radio', { name: 'required', exact: true })).toBeChecked();
  await expect(ponytail(page)).toBeChecked();
  await caption(page, 'A failed validation clears folder inheritance and keeps the manual Ponytail choice');
});

test('initialization revalidates and a pull refreshes the same folder while stale responses lose', async ({ page, request }) => {
  const fixture = await (await request.get('/api/__fixture')).json();
  await page.goto('/goals/new');
  await selectFolder(page, fixture.invalid);
  const initialize = page.getByRole('button', { name: 'Initialize git here', exact: true });
  await expect(initialize).toBeVisible();
  await expect(note(page)).toHaveCount(0);
  const initialized = page.waitForResponse((r) => r.url().endsWith('/api/validate-repo') && r.request().postDataJSON().repoPath === fixture.invalid);
  await initialize.click();
  const initializedBody = await (await initialized).json();
  expect(initializedBody).toMatchObject({ ok: true, lastGoal: { title: 'Before git initialization' } });
  await test.info().attach('Initialization revalidation → ready with the saved folder workflow', { body: JSON.stringify(initializedBody, null, 2), contentType: 'application/json' });
  await expect(page.getByText('Git repository', { exact: false }).first()).toBeVisible();
  await expect(note(page)).toHaveText('from the last goal in this folder: Before git initialization');
  await expect(suite(page).getByRole('radio', { name: 'plain', exact: true })).toBeChecked();
  await expect(tdd(page).getByRole('radio', { name: 'preferred', exact: true })).toBeChecked();
  await expect(ponytail(page)).not.toBeChecked();
  await caption(page, 'Initialization makes the folder ready and activates its previously hidden workflow source');
  const selected = page.waitForResponse((r) => r.url().endsWith('/api/validate-repo') && r.request().postDataJSON().repoPath === fixture.repo);
  await selectFolder(page, fixture.repo);
  const selectedBody = await (await selected).json();
  expect(selectedBody).toMatchObject({ ok: true, lastGoal: { title: 'Latest <folder> goal' } });
  await test.info().attach('Switching folders after initialization → the selected folder’s latest goal', { body: JSON.stringify(selectedBody, null, 2), contentType: 'application/json' });
  await expect(note(page)).toHaveText('from the last goal in this folder: Latest <folder> goal');
  let release!: () => void;
  let fetched!: () => void;
  const staleGate = new Promise<void>((resolve) => { release = resolve; });
  const fetchedGate = new Promise<void>((resolve) => { fetched = resolve; });
  let count = 0;
  await page.route('**/api/validate-repo', async (route) => {
    if (++count !== 1) return route.continue();
    const response = await route.fetch();
    fetched();
    await staleGate;
    await route.fulfill({ response });
  });
  await selectFolder(page, fixture.repo);
  await fetchedGate;
  await request.post('/api/__fixture/newer');
  await selectFolder(page, fixture.repo);
  await expect(note(page)).toHaveText('from the last goal in this folder: Refreshed folder goal');
  const stale = page.waitForResponse((r) => r.url().endsWith('/api/validate-repo'));
  release();
  await (await stale).finished();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(suite(page).getByRole('radio', { name: 'plain', exact: true })).toBeChecked();
  await expect(tdd(page).getByRole('radio', { name: 'preferred', exact: true })).toBeChecked();
  await expect(ponytail(page)).toBeChecked();
  await page.getByRole('button', { name: 'pull into my checkout', exact: true }).click();
  await expect(note(page)).toHaveText('from the last goal in this folder: Refreshed folder goal');
  await expect(page.getByText('up to date with origin/main', { exact: true })).toBeVisible();
  await caption(page, 'Same-folder validation and pull refresh the newest goal; an older overlapping response loses');
});

test('a delayed Follow-up draft preserves manual TDD and Ponytail edits', async ({ page, request }) => {
  const fixture = await (await request.get('/api/__fixture')).json();
  let release!: () => void;
  let fetched!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fetchedGate = new Promise<void>((resolve) => { fetched = resolve; });
  await page.route('**/api/goals/*/follow-up-draft', async (route) => {
    const response = await route.fetch();
    fetched();
    await gate;
    await route.fulfill({ response });
  });
  await page.goto(`/goals/new?follows=${fixture.older}`);
  await fetchedGate;
  await suite(page).getByRole('radio', { name: 'mattpocock', exact: true }).click();
  await tdd(page).getByRole('radio', { name: 'off', exact: true }).click();
  await ponytail(page).uncheck();
  release();
  await expect(page.getByText('Follows: Earlier Follow-up', { exact: true })).toBeVisible();
  await expect(suite(page).getByRole('radio', { name: 'plain', exact: true })).toBeChecked();
  await expect(tdd(page).getByRole('radio', { name: 'off', exact: true })).toBeChecked();
  await expect(ponytail(page)).not.toBeChecked();
  await expect(note(page)).toHaveCount(0);
  await caption(page, 'A delayed Follow-up keeps manual TDD and Ponytail edits while its workflow suite takes precedence');
});

for (const operation of ['init', 'pull'] as const) {
  test(`a delayed ${operation} cannot replace a subsequently selected folder`, async ({ page, request }) => {
    const fixture = await (await request.get('/api/__fixture')).json();
    if (operation === 'pull') expect((await request.post('/api/__fixture/newer')).ok()).toBe(true);
    await page.goto('/goals/new');
    const original = operation === 'init' ? fixture.invalid : fixture.repo;
    await selectFolder(page, original);
    const action = page.getByRole('button', { name: operation === 'init' ? 'Initialize git here' : 'pull into my checkout', exact: true });
    await expect(action).toBeVisible();
    let release!: () => void;
    let fetched!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchedGate = new Promise<void>((resolve) => { fetched = resolve; });
    await page.route(`**/api/repos/${operation}`, async (route) => {
      const response = await route.fetch();
      fetched();
      await gate;
      await route.fulfill({ response });
    });
    await action.click();
    await fetchedGate;
    const selected = operation === 'init' ? fixture.empty : fixture.invalid;
    await selectFolder(page, selected);
    const status = operation === 'init' ? 'Git repository' : 'not a git repository (you can initialize it)';
    await expect(page.getByText(status, { exact: false }).first()).toBeVisible();
    await expect(note(page)).toHaveCount(0);
    const obsoleteValidations: string[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('/api/validate-repo') && r.postDataJSON().repoPath === original) obsoleteValidations.push(original);
    });
    const delayed = page.waitForResponse((r) => r.url().endsWith(`/api/repos/${operation}`));
    release();
    await (await delayed).finished();
    // Settle any validation chained by the old operation before checking the winning folder.
    await page.waitForLoadState('networkidle');
    expect(obsoleteValidations).toEqual([]);
    await expect(page.getByText(status, { exact: false }).first()).toBeVisible();
    await expect(note(page)).toHaveCount(0);
    await expect(suite(page).getByRole('radio', { name: 'mattpocock', exact: true })).toBeChecked();
    await expect(tdd(page).getByRole('radio', { name: 'required', exact: true })).toBeChecked();
    await expect(ponytail(page)).toBeChecked();
    await expect(page.getByText(/^Initialized /)).toHaveCount(0);
    await caption(page, `A late ${operation} response leaves the newer folder’s status, Settings fallback and provenance intact`);
  });
}
