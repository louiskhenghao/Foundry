import { describe, expect, test } from 'bun:test';
import { TRANSFER_FORMAT_VERSION, TransferManifest, isLocalSetting, secretSettings, transferableSettings } from './transfer.ts';

describe('what a Transfer carries of the settings', () => {
  const file = {
    engine: { port: 4999, workspacesRoot: '/Users/a/work', maxConcurrent: 5 },
    models: { cheap: 'sonnet', presetCode: 'max' },
    tools: { openaiApiKey: 'sk-secret-123456', markitdownBin: '/opt/bin/markitdown', useGraphify: true },
    notifications: { telegramBotToken: 'tok', telegramChatId: '42', baseUrl: 'http://mac.local:4111', tailscaleHost: 'mac', onGoalFinished: false },
    safety: { allowedRoots: ['/Users/a'] },
    preview: { portFrom: 5000, portTo: 5099, idleMinutes: 30 },
  } as never;

  test('Settings leave out what belongs to one computer and every credential', () => {
    expect(transferableSettings(file)).toEqual({
      models: { cheap: 'sonnet', presetCode: 'max' },
      tools: { useGraphify: true },
      notifications: { telegramChatId: '42', onGoalFinished: false },
      preview: { idleMinutes: 30 },
    } as never);
    expect(isLocalSetting('engine.maxConcurrent')).toBe(true);
    expect(isLocalSetting('models.cheap')).toBe(false);
  });

  test('Keys & secrets are the credential leaves that hold a value', () => {
    expect(secretSettings(file)).toEqual({ 'tools.openaiApiKey': 'sk-secret-123456', 'notifications.telegramBotToken': 'tok' });
  });
});

test('a manifest from a later minor format still parses: unknown fields are ignored, missing ones defaulted', () => {
  const m = TransferManifest.parse({ format: 'foundry-transfer', formatVersion: TRANSFER_FORMAT_VERSION, release: '1.2.0', transferId: 'tr', exportedAt: 'now', source: { hostname: 'h', platform: 'darwin', provider: 'claude', dataDir: '/d' }, future: true, goals: [{ id: 'g', title: 't', state: 'done', createdAt: 'c', repoPath: '/r', baseBranch: 'main', branch: 'goal/g', unfinished: false, events: 3 }] });
  expect(m.goals[0]).toMatchObject({ bundle: false, artifacts: false, follows: null, remoteUrl: null });
});
