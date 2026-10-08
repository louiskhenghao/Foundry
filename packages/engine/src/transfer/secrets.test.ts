import { expect, test } from 'bun:test';
import { openSecrets, sealSecrets } from './secrets.ts';

const secrets = { settings: { 'tools.openaiApiKey': 'sk-live-0123456789' }, previewEnv: { '/Users/a/app': { DATABASE_URL: 'postgres://u:p@h/db' } } };

test('Keys & secrets open with the password they were sealed with, and only in their own Transfer', () => {
  const sealed = sealSecrets(secrets, 'correct horse', 'tr_1');
  expect(JSON.stringify(sealed)).not.toContain('sk-live');
  expect(openSecrets(sealed, 'correct horse', 'tr_1')).toEqual(secrets);
  expect(() => openSecrets(sealed, 'wrong horse', 'tr_1')).toThrow('wrong password');
  expect(() => openSecrets(sealed, 'correct horse', 'tr_2')).toThrow('wrong password');
  expect(() => openSecrets({ ...sealed, data: Buffer.from('x').toString('base64') }, 'correct horse', 'tr_1')).toThrow('wrong password');
  expect(() => sealSecrets(secrets, '', 'tr_1')).toThrow('need a password');
});
