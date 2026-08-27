/**
 * Root `bun run dev`: the engine (bun --watch) plus `vite build --watch`, so the web UI served
 * on the engine port reflects edits after a browser refresh. For HMR on :5173 use `bun run web:dev`.
 */
const children = [
  Bun.spawn(['bun', '--watch', 'apps/cli/src/main.ts', 'serve'], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' }),
  Bun.spawn(['bun', 'x', 'vite', 'build', '--watch'], { cwd: 'apps/web', stdout: 'inherit', stderr: 'inherit' }),
];

let closing = false;
const shutdown = (code: number) => {
  if (closing) return;
  closing = true;
  for (const c of children) c.kill();
  process.exit(code);
};
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
// if either side dies, stop the other so the failure is visible instead of half-running
for (const c of children) void c.exited.then((code) => shutdown(code ?? 1));
