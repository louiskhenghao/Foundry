import { describe, expect, test } from 'bun:test';
import { judgeReadOnlyShell } from '../hooks/readonly-bash.ts';

const allow = (cmd: string) => expect(judgeReadOnlyShell(cmd).allow).toBe(true);
const deny = (cmd: string) => expect(judgeReadOnlyShell(cmd).allow).toBe(false);

describe('the read-only shell guard (ADR-0073)', () => {
  test('reading the repository is allowed: git history, searches, files, pipelines', () => {
    allow('git log --oneline -n 20');
    allow('git -C /repo log --grep "Goal: g_1" --format=%h%x09%s');
    allow('git show 3f2a1b --stat');
    allow('git diff main..HEAD -- src/app.ts');
    allow('git blame -L 10,30 src/app.ts');
    allow('git branch --list "goal/*"');
    allow('git branch -a');
    allow('git tag -l "v*"');
    allow('git stash list && git worktree list');
    allow('git config --get remote.origin.url');
    allow('rg -n "TODO" src | head -50');
    allow("rg -n 'a|b' src/");
    allow('grep -rn "=>" src/lib');
    allow('cat package.json | jq ".scripts"');
    allow('find . -name "*.test.ts" -not -path "*/node_modules/*" | wc -l');
    allow('ls -la .foundry-goal/tasks && cat .foundry-goal/tasks/t_1.md');
    allow('sed -n 1,40p src/app.ts');
    allow('cd packages/core && git log -3 -- src/events.ts');
    allow('wc -l src/*.ts 2>/dev/null');
    allow('git log -1 2>&1 | head -5');
    allow('FOO=1 git status --short');
    allow('node --version; bun -v');
    allow('');
  });

  test('anything that writes or runs is denied: redirections, substitution, editing, scripts, git that changes things', () => {
    deny('echo hi > notes.txt');
    deny('cat a.txt >> b.txt');
    deny('git log $(cat ref)');
    deny('cat `which node`');
    deny('diff <(git show a:f) <(git show b:f)');
    deny('sed -i "s/a/b/" src/app.ts');
    deny('sed -ni "p" file');
    deny('find . -name "*.log" -delete');
    deny('find . -name "*.ts" -exec rm {} +');
    deny('rm -rf dist');
    deny('bun test');
    deny('npm run build');
    deny('node -e "process.exit(1)"');
    deny('python3 script.py');
    deny('git checkout main');
    deny('git branch new-branch');
    deny('git tag v9');
    deny('git branch -D old');
    deny('git stash');
    deny('git worktree add ../x');
    deny('git remote add other https://example.com/x.git');
    deny('git config user.name "x"');
    deny('git reflog expire --all');
    deny('git commit -m x');
    deny('git push');
    deny('xargs rm < list');
    deny('tee out.txt');
    deny('curl https://example.com');
    deny('rg TODO src && touch done');
    deny('ls | sh');
    deny('eval "rm x"');
  });
});
