import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeployServer } from '@foundry/core';
import type { ExecResult } from '../git/git.ts';
import { generatedCompose, publishedPort, remoteDir, serverAddress, serverDeployability, serverReadiness, serverSteps, shellQuote, sshArgv } from './server.ts';

const server: DeployServer = { id: 'srv1', name: 'box', host: 'h.example', port: 2222, user: 'deploy', privateKey: 'KEY', dir: '~/apps', publicUrl: null };

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-server-detect-'));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  return dir;
}

describe('what a server runs (ADR-0090)', () => {
  test('a compose entry’s published port, in every spelling', () => {
    expect(publishedPort('8080:80')).toBe(8080);
    expect(publishedPort('127.0.0.1:8080:80')).toBe(8080);
    expect(publishedPort('8080')).toBe(8080);
    expect(publishedPort('8080-8090:80-90')).toBe(8080);
    expect(publishedPort('3000:3000/tcp')).toBe(3000);
    expect(publishedPort(5000)).toBe(5000);
    expect(publishedPort({ target: 80, published: 8081 })).toBe(8081);
    expect(publishedPort({ target: 80, published: '8082' })).toBe(8082);
    expect(publishedPort('nope')).toBeNull();
  });

  test('a compose file: its services, the first published port, what is built and what is pulled', () => {
    const dir = repo({ 'compose.yaml': 'services:\n  db:\n    image: postgres:16\n  web:\n    build: .\n    ports:\n      - "8080:80"\n' });
    const d = serverDeployability(dir);
    expect(d).toMatchObject({ ok: true, app: { kind: 'compose', file: 'compose.yaml', services: ['db', 'web'], port: 8080 } });
    expect((d as { notes: string[] }).notes.join(' ')).toContain('db is pulled as an image on the server; web is built there from the repository');
    rmSync(dir, { recursive: true, force: true });
  });

  test('a compose file that publishes nothing runs with no address, and says so; one without services is refused', () => {
    const none = repo({ 'docker-compose.yml': 'services:\n  worker:\n    build: .\n' });
    expect(serverDeployability(none)).toMatchObject({ ok: true, app: { file: 'docker-compose.yml', port: null }, notes: [expect.stringContaining('No service publishes a port')] });
    const empty = repo({ 'compose.yml': 'version: "3"\n' });
    expect(serverDeployability(empty)).toEqual({ ok: false, reason: expect.stringContaining('names no services') });
    for (const d of [none, empty]) rmSync(d, { recursive: true, force: true });
  });

  test('a Dockerfile alone is wrapped in a compose file Foundry writes, from its EXPOSE; without one, or with nothing, it is refused in words', () => {
    const withPort = repo({ Dockerfile: 'FROM node:22\nEXPOSE 3000/tcp\nCMD ["node","server.js"]\n' });
    expect(serverDeployability(withPort)).toMatchObject({ ok: true, app: { kind: 'dockerfile', file: 'compose.foundry.yaml', services: ['app'], port: 3000 }, notes: [expect.stringContaining('writes compose.foundry.yaml')] });
    expect(generatedCompose(3000)).toContain('"3000:3000"');
    const noPort = repo({ Dockerfile: 'FROM node:22\nCMD ["node","server.js"]\n' });
    expect(serverDeployability(noPort)).toEqual({ ok: false, reason: expect.stringContaining('exposes no port') });
    const nothing = repo({ 'index.html': '<h1>hi</h1>' });
    expect(serverDeployability(nothing)).toEqual({ ok: false, reason: expect.stringContaining('no compose file') });
    for (const d of [withPort, noPort, nothing]) rmSync(d, { recursive: true, force: true });
  });

  test('the address: the public one, else host and port, else none', () => {
    expect(serverAddress(server, { port: 8080 })).toBe('http://h.example:8080');
    expect(serverAddress({ ...server, publicUrl: 'https://app.example.com/' }, { port: 8080 })).toBe('https://app.example.com');
    expect(serverAddress(server, { port: null })).toBeNull();
  });

  test('the commands: the folder made, the checkout streamed as a tar over the same ssh, compose started under the project’s name', () => {
    const steps = serverSteps({ server, name: 'site-abc123', checkout: '/data/deploy/site abc', keyFile: '/tmp/k', knownHosts: '/data/deploy/known_hosts', file: 'compose.yaml' });
    expect(steps.map((s) => s.label)).toEqual(['make the folder on the server', 'copy the project over', 'start it with docker compose']);
    const ssh = sshArgv(server, '/tmp/k', '/data/deploy/known_hosts');
    expect(ssh).toEqual(['ssh', '-i', '/tmp/k', '-p', '2222', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'UserKnownHostsFile=/data/deploy/known_hosts', '-o', 'ConnectTimeout=20', '-o', 'LogLevel=ERROR', 'deploy@h.example']);
    expect(steps[0]!.argv).toEqual([...ssh, 'mkdir -p ~/apps/site-abc123']);
    expect(steps[1]!.argv.slice(0, 2)).toEqual(['sh', '-c']);
    expect(steps[1]!.argv[2]).toBe(`tar -czf - --exclude=.git --exclude=node_modules --exclude=.vercel --exclude=.netlify --exclude=.wrangler -C '/data/deploy/site abc' . | ${ssh.map(shellQuote).join(' ')} 'tar -xzf - -C ~/apps/site-abc123'`);
    expect(steps[2]!.argv).toEqual([...ssh, "cd ~/apps/site-abc123 && docker compose -p 'site-abc123' -f 'compose.yaml' up -d --build --remove-orphans"]);
    // a folder that is not under ~ is quoted for the remote shell
    expect(remoteDir({ dir: '/srv/my apps/' }, 'x')).toBe("'/srv/my apps/x'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

/** a stand-in for ssh: answers each remote command as the server would, or as a broken one would */
function fakeRun(answers: Record<string, Partial<ExecResult>>) {
  const calls: string[] = [];
  const run = async (argv: string[]): Promise<ExecResult> => {
    const cmd = argv.at(-1)!;
    calls.push(cmd);
    const key = Object.keys(answers).find((k) => cmd.includes(k));
    return { code: 0, stdout: '', stderr: '', ...(key ? answers[key] : {}) };
  };
  return { run, calls };
}
const deps = { keyFile: '/tmp/k', knownHosts: '/tmp/kh' };

describe('the readiness check of a server', () => {
  test('every item passes on a server that answers, has docker compose and a writable folder', async () => {
    const { run, calls } = fakeRun({ 'foundry-ok': { stdout: 'foundry-ok\n' }, 'docker compose version': { stdout: 'Docker Compose version v2.29.1\n27.1.0\n' }, 'test -w': { stdout: 'writable\n' } });
    const items = await serverReadiness(server, { ...deps, run });
    expect(items.map((i) => [i.id, i.ok])).toEqual([
      ['key', true],
      ['reach', true],
      ['docker', true],
      ['folder', true],
    ]);
    expect(items[2]!.detail).toBe('Docker Compose version v2.29.1, 27.1.0');
    expect(calls).toEqual(['echo foundry-ok', "docker compose version && docker info --format '{{.ServerVersion}}'", 'mkdir -p ~/apps && test -w ~/apps && echo writable']);
  });

  test('without a key nothing is tried; a refused key says whose and how to add it; a changed host key points at Settings', async () => {
    const none = await serverReadiness({ ...server, privateKey: null }, { ...deps, keyFile: null, run: fakeRun({}).run });
    expect(none.map((i) => [i.id, i.ok, i.detail.startsWith('not tried')])).toEqual([
      ['key', false, false],
      ['reach', false, true],
      ['docker', false, true],
      ['folder', false, true],
    ]);
    const refused = await serverReadiness(server, { ...deps, run: fakeRun({ 'foundry-ok': { code: 255, stderr: 'deploy@h.example: Permission denied (publickey).\n' } }).run });
    expect(refused[1]).toMatchObject({ id: 'reach', ok: false, detail: 'h.example refused the key for deploy: deploy@h.example: Permission denied (publickey).', fix: { command: expect.stringContaining('authorized_keys') } });
    expect(refused.slice(2).every((i) => !i.ok && i.detail.includes('could not be reached'))).toBe(true);
    const changed = await serverReadiness(server, { ...deps, run: fakeRun({ 'foundry-ok': { code: 255, stderr: 'Host key verification failed.\n' } }).run });
    expect(changed[1]).toMatchObject({ ok: false, detail: expect.stringContaining('host key changed'), fix: { settings: 'git' } });
  });

  test('docker missing, or not allowed for the user, is said with its remedy; a folder that cannot be written too', async () => {
    const missing = await serverReadiness(server, { ...deps, run: fakeRun({ 'foundry-ok': { stdout: 'foundry-ok' }, 'docker compose version': { code: 127, stderr: 'sh: 1: docker: not found\n' }, 'test -w': { stdout: 'writable' } }).run });
    expect(missing[2]).toMatchObject({ id: 'docker', ok: false, detail: 'Docker is not installed on h.example: sh: 1: docker: not found', fix: { url: 'https://docs.docker.com/engine/install/' } });
    const socket = await serverReadiness(server, { ...deps, run: fakeRun({ 'foundry-ok': { stdout: 'foundry-ok' }, 'docker compose version': { code: 1, stderr: 'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock\n' }, 'test -w': { code: 1, stderr: 'mkdir: cannot create directory: Permission denied\n' } }).run });
    expect(socket[2]).toMatchObject({ ok: false, detail: expect.stringContaining('deploy may not use Docker there'), fix: { command: 'sudo usermod -aG docker deploy' } });
    expect(socket[3]).toMatchObject({ id: 'folder', ok: false, detail: expect.stringContaining('could not be made or written as deploy') });
  });
});
