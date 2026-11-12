import { describe, expect, test } from 'bun:test';
import { repoSlug, sameGithubRepo } from './policy.ts';

describe('repoSlug', () => {
  test('owner/name from every GitHub URL shape, dots in the name kept', () => {
    expect(repoSlug('https://github.com/me/app.git')).toBe('me/app');
    expect(repoSlug('https://github.com/me/app')).toBe('me/app');
    expect(repoSlug('https://github.com/me/app/')).toBe('me/app');
    expect(repoSlug('git@github.com:me/app.git')).toBe('me/app');
    expect(repoSlug('ssh://git@github.com/me/app.git')).toBe('me/app');
    expect(repoSlug('https://github.com/me/my.app.git')).toBe('me/my.app');
    expect(repoSlug('https://github.com/me/site.github.io')).toBe('me/site.github.io');
    expect(repoSlug('https://github.com/me/app/issues/5')).toBe('me/app');
  });
  test('anything else comes back as it was', () => {
    expect(repoSlug('/tmp/bare.git')).toBe('/tmp/bare.git');
    expect(repoSlug('https://gitlab.com/me/app.git')).toBe('https://gitlab.com/me/app.git');
  });
});

describe('sameGithubRepo', () => {
  test('the repository GitHub renamed is the one the policy asked for', () => {
    expect(sameGithubRepo('me/My-App-V2', { owner: 'me', name: 'My App V2' })).toBe(true);
    expect(sameGithubRepo('ME/my-app-v2', { owner: 'me', name: 'My-App-V2' })).toBe(true);
    expect(sameGithubRepo('me/other', { owner: 'me', name: 'My App V2' })).toBe(false);
    expect(sameGithubRepo('you/My-App-V2', { owner: 'me', name: 'My-App-V2' })).toBe(false);
  });
});
