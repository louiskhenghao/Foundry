import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ request }) => { expect((await request.post('/api/__fixture/reset')).ok()).toBe(true); });

const suite = (page: Page) => page.getByRole('radiogroup', { name: 'Workflow suite', exact: true });
const tdd = (page: Page) => page.getByRole('radiogroup', { name: 'Engineering discipline — TDD', exact: true });
const ponytail = (page: Page) => page.getByRole('checkbox', { name: /Ponytail —/ });
const note = (page: Page) => page.getByText(/^from the last goal in this folder:/);
async function caption(page: Page, text: string) {
  await test.info().attach(text, { body: await page.screenshot(), contentType: 'image/png' });
}
async function selectFolder(page: Page, path: string) {
  const edit = page.getByRole('button', { name: 'edit path', exact: true });
  if (await edit.isVisible()) await edit.click();
  const input = page.getByPlaceholder('or type a path: /Users/you/projects/my-app');
  await input.fill(path);
  await input.press('Enter');
}
async function expectFollowUpWorkflow(page: Page) {
  await expect(suite(page).getByRole('radio', { name: 'plain', exact: true })).toBeChecked();
  await expect(tdd(page).getByRole('radio', { name: 'preferred', exact: true })).toBeChecked();
  await expect(ponytail(page)).toBeChecked();
  await expect(note(page)).toHaveCount(0);
}

test('the draft endpoint returns the chosen older goal’s workflow rather than the newest folder goal', async ({ request }) => {
  const fixture = await (await request.get('/api/__fixture')).json();
  const draftResponse = await request.get(`/api/goals/${fixture.older}/follow-up-draft`);
  expect(draftResponse.ok()).toBe(true);
  const draft = await draftResponse.json();
  expect(draft.prefill).toMatchObject({ profile: 'plain', tdd: 'preferred', ponytail: 'on' });
  await test.info().attach('Older goal Follow-up draft → plain, preferred TDD and Ponytail on', { body: JSON.stringify(draft, null, 2), contentType: 'application/json' });
  const validatedResponse = await request.post('/api/validate-repo', { data: { repoPath: fixture.repo } });
  expect(validatedResponse.ok()).toBe(true);
  const validated = await validatedResponse.json();
  expect(validated).toMatchObject({ ok: true, lastGoal: { goalId: 'g_latest', workflow: { profile: 'pstack', tdd: 'off', ponytail: 'off' } } });
  expect(draft.previous.id).toBe(fixture.older);
  expect(draft.followable).toBe(true);
  await test.info().attach('Same folder validation → contrasting newest goal workflow', { body: JSON.stringify(validated, null, 2), contentType: 'application/json' });
});

test('the finished older goal’s Follow-up link wins over delayed folder validation and Settings', async ({ page, request }) => {
  const fixture = await (await request.get('/api/__fixture')).json();
  await page.goto(`/goals/${fixture.older}`);
  const followUp = page.getByRole('link', { name: 'Continue with a follow-up…', exact: true });
  await expect(followUp).toBeVisible();
  await caption(page, 'Finished earlier goal offers Continue with a follow-up');

  let releaseSettings!: () => void;
  let releaseValidation!: () => void;
  const settingsGate = new Promise<void>((resolve) => { releaseSettings = resolve; });
  const validationGate = new Promise<void>((resolve) => { releaseValidation = resolve; });
  await page.route('**/api/settings', async (route) => { const response = await route.fetch(); await settingsGate; await route.fulfill({ response }); });
  await page.route('**/api/validate-repo', async (route) => { const response = await route.fetch(); await validationGate; await route.fulfill({ response }); });
  const settingsRequested = page.waitForRequest('**/api/settings');
  await followUp.click();
  await settingsRequested;
  await expect(page).toHaveURL(`/goals/new?follows=${fixture.older}`);
  await expect(page.getByText('Follows: Earlier Follow-up', { exact: true })).toBeVisible();
  await expectFollowUpWorkflow(page);
  await suite(page).scrollIntoViewIfNeeded();
  await caption(page, 'While validation and Settings wait, all three choices come from the older Follow-up');

  const validated = page.waitForResponse('**/api/validate-repo');
  releaseValidation();
  const validation = await (await validated).json();
  expect(validation).toMatchObject({ ok: true, lastGoal: { title: 'Latest <folder> goal', workflow: { profile: 'pstack', tdd: 'off', ponytail: 'off' } } });
  await test.info().attach('Delayed repository validation → newer folder goal loses to Follow-up', { body: JSON.stringify(validation, null, 2), contentType: 'application/json' });
  await expect(page.getByText('Git repository', { exact: false }).first()).toBeVisible();
  await expectFollowUpWorkflow(page);
  const settingsReturned = page.waitForResponse('**/api/settings');
  releaseSettings();
  await (await settingsReturned).finished();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.unroute('**/api/settings');
  await page.unroute('**/api/validate-repo');
  await expectFollowUpWorkflow(page);
  await caption(page, 'After both delayed responses, the older goal still wins and no folder source note appears');

  await suite(page).getByRole('radio', { name: 'mattpocock', exact: true }).click();
  await tdd(page).getByRole('radio', { name: 'off', exact: true }).click();
  await ponytail(page).uncheck();
  const revalidated = page.waitForResponse('**/api/validate-repo');
  await selectFolder(page, fixture.repo);
  await (await revalidated).finished();
  await expect(suite(page).getByRole('radio', { name: 'mattpocock', exact: true })).toBeChecked();
  await expect(tdd(page).getByRole('radio', { name: 'off', exact: true })).toBeChecked();
  await expect(ponytail(page)).not.toBeChecked();
  await expect(note(page)).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 812 });
  await suite(page).scrollIntoViewIfNeeded();
  await caption(page, 'Phone width: later manual choices survive revalidation without folder provenance');
});

test('the on-page Follows picker only links and preserves the folder workflow and manual choices', async ({ page, request }) => {
  const fixture = await (await request.get('/api/__fixture')).json();
  await page.goto('/goals/new');
  await selectFolder(page, fixture.empty);
  await expect(page.getByText('Git repository', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Follows', exact: true })).toHaveCount(0);
  await caption(page, 'A folder with no finished goals has no Follows picker');
  await selectFolder(page, fixture.repo);
  await expect(note(page)).toHaveText('from the last goal in this folder: Latest <folder> goal');
  const picker = page.getByRole('combobox', { name: 'Follows', exact: true });
  await picker.selectOption(fixture.older);
  await expect(page.getByText('Follows: Earlier Follow-up', { exact: true })).toBeVisible();
  await expect(suite(page).getByRole('radio', { name: 'pstack', exact: true })).toBeChecked();
  await expect(tdd(page).getByRole('radio', { name: 'off', exact: true })).toBeChecked();
  await expect(ponytail(page)).not.toBeChecked();
  await expect(note(page)).toBeVisible();
  await suite(page).scrollIntoViewIfNeeded();
  await caption(page, 'Picking the older goal links it while the newer folder goal still supplies the workflow');

  await picker.selectOption('');
  await expect(page.getByText('Follows: Earlier Follow-up', { exact: true })).toHaveCount(0);
  await suite(page).getByRole('radio', { name: 'plain', exact: true }).click();
  await tdd(page).getByRole('radio', { name: 'required', exact: true }).click();
  await ponytail(page).check();
  await page.getByRole('checkbox', { name: /^Fast mode/ }).check();
  await picker.selectOption(fixture.older);
  await expect(page.getByText('Follows: Earlier Follow-up', { exact: true })).toBeVisible();
  await expect(suite(page).getByRole('radio', { name: 'plain', exact: true })).toBeChecked();
  await expect(ponytail(page)).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /^Fast mode/ })).toBeChecked();
  await page.getByRole('checkbox', { name: /^Fast mode/ }).uncheck();
  await expect(tdd(page).getByRole('radio', { name: 'required', exact: true })).toBeChecked();
  await expect(note(page)).toHaveCount(0);
  await suite(page).scrollIntoViewIfNeeded();
  await caption(page, 'The linking-only picker also preserves manual suite, TDD, Ponytail and pace choices');
});

for (const view of ['Simple', 'Fast'] as const) {
  test(`Follow-up keeps ${view} TDD submission behavior`, async ({ page, request }) => {
    const fixture = await (await request.get('/api/__fixture')).json();
    await page.goto(`/goals/new?follows=${fixture.older}`);
    await expectFollowUpWorkflow(page);
    await expect(page.getByText('Git repository', { exact: false }).first()).toBeVisible();
    if (view === 'Simple') await page.getByRole('button', { name: /^Simple/ }).click();
    else await page.getByRole('checkbox', { name: /^Fast mode/ }).check();
    await page.getByPlaceholder('Describe the goal as you would to a senior engineer.', { exact: false }).fill(`Continue the older goal in ${view}`);
    await caption(page, `${view} Follow-up ready to create with the inherited workflow`);
    const submitted = page.waitForResponse((r) => r.url().endsWith('/api/goals') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create & clarify', exact: true }).click();
    const response = await submitted;
    expect(response.status()).toBe(201);
    const body = response.request().postDataJSON();
    expect(body.follows.goalId).toBe(fixture.older);
    expect(body.workflow.profile).toBe('plain');
    expect(body.workflow.ponytail).toBe('on');
    if (view === 'Simple') expect(body.workflow.tdd).toBe('preferred');
    else expect(body.workflow).not.toHaveProperty('tdd');
    const saved = await response.json();
    expect(saved.workflow.tdd).toBe(view === 'Simple' ? 'preferred' : 'off');
    await test.info().attach(`${view} Follow-up POST /api/goals → 201`, { body: JSON.stringify(saved, null, 2), contentType: 'application/json' });
  });
}
