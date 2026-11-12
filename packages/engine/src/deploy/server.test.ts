import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeployServer } from '@foundry/core';
import type { ExecResult } from '../git/git.ts';
import { folderScript, generatedCompose, parseListeners, publishedPort, remoteDir, reviewCompose, serverAddress, serverDeployability, serverReadiness, serverSteps, shellQuote, sshArgv } from './server.ts';

const server: DeployServer = { id: 'srv1', name: 'box', host: 'h.example', port: 2222, user: 'deploy', privateKey: 'KEY', dir: '~/apps', publicUrl: null, allowPrivileged: false };

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-server-detect-'));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  return dir;
}

describe('what a server runs (ADR-0091)', () => {
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
    expect(steps[0]!.argv).toEqual([...ssh, folderScript('~/apps/site-abc123')]);
    expect(folderScript('~/apps/site-abc123')).toContain('already holds files that are not a Foundry deploy');
    expect(folderScript('~/apps/site-abc123')).toContain('mkdir -p "$p" && touch "$p/.foundry-deploy"');
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
      ['front', false],
    ]);
    expect(items[2]!.detail).toBe('Docker Compose version v2.29.1, 27.1.0');
    expect(calls.slice(0, 3)).toEqual(['echo foundry-ok', "docker compose version && docker info --format '{{.ServerVersion}}'", 'd=~/apps; mkdir -p "$d" && test -w "$d" && echo writable']);
    expect(calls[3]).toContain('ss -ltnpH');
    // nothing in front: told, never blocking
    expect(items[4]).toMatchObject({ id: 'front', ok: false, severity: 'warn', detail: expect.stringContaining('nothing listens on 80 or 443'), fix: { url: expect.stringContaining('caddyserver') } });
  });

  test('without a key nothing is tried; a refused key says whose and how to add it; a changed host key points at Settings', async () => {
    const none = await serverReadiness({ ...server, privateKey: null }, { ...deps, keyFile: null, run: fakeRun({}).run });
    expect(none.map((i) => [i.id, i.ok, i.detail.startsWith('not tried')])).toEqual([
      ['key', false, false],
      ['reach', false, true],
      ['docker', false, true],
      ['folder', false, true],
      ['front', false, true],
    ]);
    const refused = await serverReadiness(server, { ...deps, run: fakeRun({ 'foundry-ok': { code: 255, stderr: 'deploy@h.example: Permission denied (publickey).\n' } }).run });
    expect(refused[1]).toMatchObject({ id: 'reach', ok: false, detail: 'h.example refused the key for deploy: deploy@h.example: Permission denied (publickey).', fix: { command: expect.stringContaining('authorized_keys') } });
    expect(refused.slice(2).every((i) => !i.ok && i.detail.includes('could not be reached'))).toBe(true);
    expect(refused.map((i) => i.id)).toEqual(['key', 'reach', 'docker', 'folder', 'front']);
    const changed = await serverReadiness(server, { ...deps, run: fakeRun({ 'foundry-ok': { code: 255, stderr: 'Host key verification failed.\n' } }).run });
    expect(changed[1]).toMatchObject({ ok: false, detail: expect.stringContaining('host key changed'), fix: { settings: 'git' } });
  });

  test('docker missing, or not allowed for the user, is said with its remedy; a folder that cannot be written too', async () => {
    const missing = await serverReadiness(server, { ...deps, run: fakeRun({ 'foundry-ok': { stdout: 'foundry-ok' }, 'docker compose version': { code: 127, stderr: 'sh: 1: docker: not found\n' }, 'test -w': { stdout: 'writable' } }).run });
    expect(missing[2]).toMatchObject({ id: 'docker', ok: false, detail: 'Docker is not installed on h.example: sh: 1: docker: not found', fix: { url: 'https://docs.docker.com/engine/install/' } });
    const socket = await serverReadiness(server, { ...deps, run: fakeRun({ 'foundry-ok': { stdout: 'foundry-ok' }, 'docker compose version': { code: 1, stderr: 'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock\n' }, 'test -w': { code: 1, stderr: 'mkdir: cannot create directory: Permission denied\n' } }).run });
    // the command is the person's to run, and says what it changes
    const cmd = String(socket[2]!.fix!.command);
    expect(cmd).toContain('sudo usermod -aG docker deploy');
    expect(cmd).toContain('a member of the docker group can act as root');
    expect(socket[2]).toMatchObject({ ok: false, detail: expect.stringContaining('deploy may not use Docker there') });
    expect(socket[3]).toMatchObject({ id: 'folder', ok: false, detail: expect.stringContaining('could not be made or written as deploy') });
  });
});

describe('the compose review (ADR-0091): what a file would reach outside its project', () => {
  const doc = (yaml: string) => Bun.YAML.parse(yaml) as Parameters<typeof reviewCompose>[0];
  test('an ordinary project: built and pulled services, ports, named volumes and binds inside the folder; nothing refused', () => {
    const r = reviewCompose(doc('services:\n  web:\n    build: .\n    ports: ["8080:80", "9090:9090"]\n    volumes:\n      - ./data:/app/data\n      - uploads:/app/uploads\n  db:\n    image: postgres:16\n    volumes:\n      - pg:/var/lib/postgresql/data\nvolumes:\n  pg: {}\n  uploads: {}\n'));
    expect(r).toEqual({ dangers: [], ports: [8080, 9090], built: ['web'], pulled: ['db'], volumes: ['uploads', 'pg'], binds: ['./data'] });
  });
  test('what reaches outside is named with its service: the Docker socket, privileged, the host network and pid, capabilities, devices, bind mounts elsewhere, a volume bound to a device', () => {
    const r = reviewCompose(doc('services:\n  agent:\n    image: x\n    privileged: true\n    network_mode: host\n    pid: host\n    cap_add: [SYS_ADMIN]\n    security_opt: ["apparmor:unconfined"]\n    devices: ["/dev/kvm:/dev/kvm"]\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n      - /etc:/host-etc:ro\n      - ~/.ssh:/root/.ssh\n      - ../other:/other\n      - type: bind\n        source: /srv/data\n        target: /data\nvolumes:\n  raw:\n    driver_opts:\n      type: none\n      device: /mnt/disk\n'));
    expect(r.dangers).toEqual([
      'agent runs privileged: the container would have the server\'s own powers',
      "agent uses the host's network (network_mode: host): every port of the server, not the project's",
      "agent shares the host's pid (pid: host)",
      'agent adds capabilities (cap_add: SYS_ADMIN)',
      'agent turns a security profile off (security_opt)',
      "agent opens the server's devices (devices: /dev/kvm:/dev/kvm)",
      'agent mounts the Docker socket (/var/run/docker.sock): the container would control every container on the server',
      'agent bind-mounts /etc, outside the project folder',
      'agent bind-mounts ~/.ssh, outside the project folder',
      'agent bind-mounts ../other, outside the project folder',
      'agent bind-mounts /srv/data, outside the project folder',
      'volume raw binds /mnt/disk, outside the project folder',
    ]);
    expect(r.ports).toEqual([]);
  });
  test('the review travels with what a server runs; a Dockerfile alone reaches nothing', () => {
    const dir = repo({ 'compose.yaml': 'services:\n  api:\n    build: .\n    privileged: true\n    ports: ["3000:3000"]\n' });
    const d = serverDeployability(dir);
    expect(d).toMatchObject({ ok: true, app: { review: { dangers: [expect.stringContaining('api runs privileged')], ports: [3000] } } });
    rmSync(dir, { recursive: true, force: true });
    const df = repo({ Dockerfile: 'FROM nginx\nEXPOSE 80\n' });
    expect(serverDeployability(df)).toMatchObject({ ok: true, app: { review: { dangers: [], ports: [80], built: ['app'] } } });
    rmSync(df, { recursive: true, force: true });
  });
});

describe('what the readiness check sees of the server beyond Docker', () => {
  const SS = 'LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=812,fd=6))\nLISTEN 0 511 [::]:443 [::]:* users:(("nginx",pid=812,fd=7))\nLISTEN 0 4096 0.0.0.0:8080 0.0.0.0:* users:(("docker-proxy",pid=2001,fd=4))\nLISTEN 0 128 0.0.0.0:22 0.0.0.0:*\n';
  test('listeners are read from ss, with the program when shown', () => {
    expect(parseListeners(SS)).toEqual([
      { port: 80, program: 'nginx' },
      { port: 443, program: 'nginx' },
      { port: 8080, program: 'docker-proxy' },
      { port: 22, program: null },
    ]);
    expect(parseListeners('tcp        0      0 0.0.0.0:5432            0.0.0.0:*               LISTEN      901/postgres\n')).toEqual([{ port: 5432, program: 'postgres' }]);
  });
  const answers = (over: Record<string, Partial<ExecResult>> = {}) => ({ 'foundry-ok': { stdout: 'foundry-ok\n' }, 'docker compose version': { stdout: 'Docker Compose version v2.29.1\n' }, 'test -w': { stdout: 'writable\nproject=new\n' }, 'ss -ltnpH': { stdout: `${SS}::ours::\n` }, ...over });
  test('a published port held by another program blocks; one held by this project\'s earlier deploy, or free, does not; what is in front is told', async () => {
    const taken = await serverReadiness(server, { ...deps, project: { name: 'site-1', ports: [8080, 9090] }, run: fakeRun(answers()).run });
    expect(taken.find((i) => i.id === 'ports')).toMatchObject({ ok: false, severity: 'error', detail: expect.stringContaining('already in use on the server: 8080 (docker-proxy)') });
    expect(taken.find((i) => i.id === 'front')).toMatchObject({ ok: true, severity: 'warn', detail: 'nginx listens on 80, nginx listens on 443' });
    expect(taken.find((i) => i.id === 'folder')).toMatchObject({ ok: true, detail: expect.stringContaining("the project's folder will be made") });
    const ours = await serverReadiness(server, { ...deps, project: { name: 'site-1', ports: [8080] }, run: fakeRun(answers({ 'ss -ltnpH': { stdout: `${SS}::ours::\n0.0.0.0:8080->80/tcp\n` }, 'test -w': { stdout: 'writable\nproject=ours\n' } })).run });
    expect(ours.find((i) => i.id === 'ports')).toMatchObject({ ok: true, detail: "8080 (this project's own, from an earlier deploy)" });
    expect(ours.find((i) => i.id === 'folder')).toMatchObject({ ok: true, detail: expect.stringContaining("Foundry's from an earlier deploy") });
    expect(ours.every((i) => i.ok || i.severity === 'warn')).toBe(true);
  });
  test('a project folder that holds something else is never written over; the check says so and points at Settings', async () => {
    const r = await serverReadiness(server, { ...deps, project: { name: 'site-1', ports: [] }, run: fakeRun(answers({ 'test -w': { stdout: 'writable\nproject=foreign\n' } })).run });
    expect(r.find((i) => i.id === 'folder')).toMatchObject({ ok: false, severity: 'error', detail: expect.stringContaining('already holds files that are not a Foundry deploy'), fix: { settings: 'git' } });
    expect(r.find((i) => i.id === 'ports')).toBeUndefined();
  });
  test('the public address is looked at from here: answering, behind Cloudflare, a bad certificate, no DNS, nothing yet — told, never blocking', async () => {
    const withUrl = { ...server, publicUrl: 'https://app.example.com' };
    const at = (probe: NonNullable<(typeof deps & { probe?: unknown })['probe']>) => serverReadiness(withUrl, { ...deps, run: fakeRun(answers()).run, probe: probe as never }).then((items) => items.find((i) => i.id === 'public')!);
    expect(await at(async () => ({ status: 200, headers: new Headers({ 'cf-ray': 'abc' }) }))).toMatchObject({ ok: true, severity: 'warn', detail: 'https://app.example.com answers (HTTP 200, behind Cloudflare)' });
    expect(await at(async () => ({ status: 302, headers: new Headers({ server: 'nginx' }) }))).toMatchObject({ ok: true, detail: 'https://app.example.com answers (HTTP 302, nginx)' });
    expect(await at(async () => ({ error: 'CERT_HAS_EXPIRED' }))).toMatchObject({ ok: false, severity: 'warn', detail: expect.stringContaining('a certificate the browser would refuse (CERT_HAS_EXPIRED)') });
    expect(await at(async () => ({ error: 'ENOTFOUND' }))).toMatchObject({ ok: false, detail: expect.stringContaining('does not resolve: add a DNS record for it pointing at h.example') });
    expect(await at(async () => ({ error: 'ECONNREFUSED' }))).toMatchObject({ ok: false, detail: expect.stringContaining('nothing answers at https://app.example.com yet') });
  });
});
