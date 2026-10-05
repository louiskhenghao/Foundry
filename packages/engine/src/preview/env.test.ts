import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkoutEnv, EnvConflictError, exampleComments, exampleKeys, fileKeys, keyUsage, parseDotenv, PreviewEnvStore, redactor } from './env.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tree = (files: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), 'foundry-env-'));
  dirs.push(d);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(d, path, '..'), { recursive: true });
    writeFileSync(join(d, path), body);
  }
  return d;
};

describe('parseDotenv', () => {
  test('plain, exported, quoted, multi-line and commented values', () => {
    expect(
      parseDotenv([
        '# a comment',
        'A=1',
        'export B = two words # trailing comment',
        'C="line\\nnext"',
        "D='keeps \\n and # as is'",
        'E="first',
        'second"',
        'F=',
        'URL=postgres://u:p@h:5432/db?x=1#frag',
        'not a variable',
      ].join('\r\n')),
    ).toEqual({ A: '1', B: 'two words', C: 'line\nnext', D: 'keeps \\n and # as is', E: 'first\nsecond', F: '', URL: 'postgres://u:p@h:5432/db?x=1#frag' });
  });
  test('like dotenv: an unterminated quote is a one-line value, only \\n and \\r are escapes, NUL values are dropped', () => {
    expect(parseDotenv('A="hello\nB=2\nC=3')).toEqual({ A: '"hello', B: '2', C: '3' });
    expect(parseDotenv('P="C:\\temp\\new"')).toEqual({ P: 'C:\\temp\new' });
    expect(parseDotenv('X=a\0b\nY=ok')).toEqual({ Y: 'ok' });
  });
});

describe('checkoutEnv', () => {
  test('untracked env files of the root and app folders, the more specific winning; tracked files are left to the worktree', () => {
    const repo = tree({ '.env': 'A=root\nB=root\n', '.env.local': 'B=local\n', 'apps/api/.env': 'A=api\nC=api\n', 'apps/web/.env': 'W=tracked\n' });
    const env = checkoutEnv(repo, ['apps/api', 'apps/web'], () => new Set(['apps/web/.env']));
    expect(env.files).toEqual(['.env', '.env.local', 'apps/api/.env']);
    expect(env.vars).toEqual({ A: 'api', B: 'local', C: 'api' });
    expect(checkoutEnv(tree({}), [], () => new Set())).toEqual({ files: [], vars: {} });
  });
  test('asks git which env files are tracked, also in folders with non-ASCII names', () => {
    const repo = tree({ '.env': 'SECRET=1\n', '.env.development': 'TRACKED=1\n', 'apps/平台/.env': 'T=1\n', 'apps/平台/.env.local': 'U=1\n' });
    Bun.spawnSync(['git', 'init', '-q', repo]);
    Bun.spawnSync(['git', '-C', repo, 'add', '-f', '.env.development', 'apps/平台/.env']);
    expect(checkoutEnv(repo, ['apps/平台']).files).toEqual(['.env', 'apps/平台/.env.local']);
  });
});

describe('exampleKeys and fileKeys', () => {
  test('keys documented in example files, first mention wins; keys env files define', () => {
    const ws = tree({ '.env.example': 'DATABASE_URL=postgres://localhost/app\nPORT=3000\n', 'apps/api/.env.sample': 'JWT_SECRET=change-me\nPORT=4000\n', 'apps/api/.env': 'LOG=1\n' });
    expect(exampleKeys(ws, ['apps/api'])).toEqual([
      { key: 'DATABASE_URL', example: 'postgres://localhost/app', file: '.env.example', comment: null },
      { key: 'PORT', example: '3000', file: '.env.example', comment: null },
      { key: 'JWT_SECRET', example: 'change-me', file: 'apps/api/.env.sample', comment: null },
    ]);
    expect([...fileKeys(ws, ['apps/api'])]).toEqual(['LOG']);
  });
  test('the comment above a key or after its value describes it; headings, separators and commented-out keys do not', () => {
    const text = [
      '# ---- Telegram ----',
      '',
      '# Bot token from @BotFather',
      '# (use a test bot)',
      'TELEGRAM_BOT_TOKEN=',
      '# OLD_KEY=1',
      'ADMIN_ID=123 # your numeric id',
      'QUOTED="a # b"',
      '',
      '##########',
      'PLAIN=1',
    ].join('\n');
    expect(exampleComments(text)).toEqual({ TELEGRAM_BOT_TOKEN: 'Bot token from @BotFather (use a test bot)', ADMIN_ID: 'your numeric id' });
  });
  test('files that read each key, from one git grep; env files are left out', () => {
    const ws = tree({ 'src/config.ts': 'export const t = process.env.BOT_TOKEN;\nconst u = process.env.DB_URL;\n', 'src/db.ts': 'connect(process.env.DB_URL)\n', '.env.example': 'BOT_TOKEN=\n' });
    Bun.spawnSync(['git', 'init', '-q', ws]);
    Bun.spawnSync(['git', '-C', ws, 'add', '-A']);
    expect(keyUsage(ws, ['BOT_TOKEN', 'DB_URL', 'NOT_USED'])).toEqual({ BOT_TOKEN: ['src/config.ts'], DB_URL: ['src/config.ts', 'src/db.ts'] });
  });
});

describe('PreviewEnvStore', () => {
  test('per repository, owner-only on disk, null keeps a stored value, an empty set removes the repository', () => {
    const data = tree({});
    const store = new PreviewEnvStore(data);
    expect(store.get('/r/a')).toEqual({ rev: 0, vars: {} });
    expect(store.set('/r/a', { API_KEY: 's3cret', OTHER: 'x' }, 0)).toEqual({ rev: 1, vars: { API_KEY: 's3cret', OTHER: 'x' } });
    store.set('/r/b', { X: '1' }, 0);
    // the UI sends null for values it never saw; OTHER left out is removed
    expect(store.set('/r/a', { API_KEY: null, NEW: 'n' }, 1)).toEqual({ rev: 2, vars: { API_KEY: 's3cret', NEW: 'n' } });
    expect(new PreviewEnvStore(data).get('/r/a').vars).toEqual({ API_KEY: 's3cret', NEW: 'n' });
    expect(statSync(join(data, 'preview-env.json')).mode & 0o777).toBe(0o600);
    // emptied, the set keeps its revision: a tab still at rev 2 cannot save over it
    store.set('/r/a', {}, 2);
    expect(store.get('/r/a')).toEqual({ rev: 3, vars: {} });
    expect(() => store.set('/r/a', { A: 'x' }, 2)).toThrow(EnvConflictError);
    expect(store.get('/r/b').vars).toEqual({ X: '1' });
  });
  test('refuses a save from an outdated view, bad names, NUL bytes; never overwrites a file it cannot read', () => {
    const data = tree({});
    const store = new PreviewEnvStore(data);
    store.set('/r', { A: '1' }, 0);
    expect(() => store.set('/r', { A: '2' }, 0)).toThrow(EnvConflictError);
    expect(() => store.set('/r', { 'BAD-NAME': 'x' }, 1)).toThrow(/not a variable name/);
    expect(() => store.set('/r', { A: 'a\0b' }, 1)).toThrow(/NUL/);
    // keeping a value only works for a name that has one (a renamed row would silently lose its secret)
    expect(() => store.set('/r', { RENAMED: null }, 1)).toThrow(/no saved value to keep/);
    expect(store.get('/r').vars).toEqual({ A: '1' });
    writeFileSync(join(data, 'preview-env.json'), '{ broken');
    expect(() => store.set('/r', { A: '3' }, 1)).toThrow();
    expect(readFileSync(join(data, 'preview-env.json'), 'utf8')).toBe('{ broken');
  });
  test('merge adds only keys that are not set yet', () => {
    const store = new PreviewEnvStore(tree({}));
    store.set('/r', { A: 'mine' }, 0);
    expect(store.merge('/r', { A: 'checkout', B: 'checkout' })).toEqual(['B']);
    expect(store.get('/r').vars).toEqual({ A: 'mine', B: 'checkout' });
  });
});

describe('redactor', () => {
  test('hides values of 6 or more characters, longest first; short ones are left alone', () => {
    const redact = redactor(['postgres://u:p@h/db', 'p@h/db', '1']);
    expect(redact('connecting to postgres://u:p@h/db failed (1 try)')).toBe('connecting to •••• failed (1 try)');
    expect(redactor([])('anything')).toBe('anything');
    // output arrives line by line: each line of a multi-line value (a private key) is hidden too
    const key = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----';
    expect(redactor([key])('loaded MIIEvQIBADANBgkqhkiG9w0BAQEFAASC from env')).toBe('loaded •••• from env');
  });
});
