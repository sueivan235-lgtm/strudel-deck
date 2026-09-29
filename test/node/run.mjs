// npm test: unit tests, then the FERRUM equivalence check.
import { spawnSync } from 'node:child_process';

const node = process.execPath;
const hooks = ['--import', new URL('./register.mjs', import.meta.url).pathname];
const steps = [
  [...hooks, '--test', new URL('./unit.test.mjs', import.meta.url).pathname],
  [...hooks, new URL('./ferrum-equivalence.mjs', import.meta.url).pathname],
];
let failed = false;
for (const args of steps) {
  const r = spawnSync(node, args, { stdio: 'inherit' });
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
