import { describe, expect, test } from 'bun:test';
import { DeliveryPolicy, githubRepoName } from './delivery.ts';

describe('githubRepoName', () => {
  test('a folder name becomes the name GitHub gives the repository', () => {
    expect(githubRepoName('My App V2')).toBe('My-App-V2');
    expect(githubRepoName('my app (beta)!')).toBe('my-app--beta--');
    expect(githubRepoName('  padded  ')).toBe('padded');
    expect(githubRepoName('ok_name.v2-x')).toBe('ok_name.v2-x');
    expect(githubRepoName('项目 🚀')).toBe('----');
    expect(githubRepoName('x'.repeat(120))).toHaveLength(100);
  });

  test('the policy records the GitHub name, whatever was typed', () => {
    const p = DeliveryPolicy.parse({ mode: 'pr', createRepo: { owner: 'me', name: 'My App V2' } });
    expect(p.createRepo).toEqual({ owner: 'me', name: 'My-App-V2', visibility: 'private' });
    expect(DeliveryPolicy.parse({ createRepo: null }).createRepo).toBeNull();
  });
});
