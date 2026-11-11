// 一条命令同时起账本 API（8790）和前端（5173）。任何一个退出，另一个也跟着停。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = (name) => fileURLToPath(new URL(`../node_modules/.bin/${name}`, import.meta.url));
const procs = [
  spawn(bin('tsx'), ['watch', '--clear-screen=false', 'server/index.ts'], { stdio: 'inherit' }),
  spawn(bin('vite'), [], { stdio: 'inherit' }),
];

let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill('SIGTERM');
  process.exit(code);
};
for (const p of procs) p.on('exit', (code) => stop(code ?? 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
