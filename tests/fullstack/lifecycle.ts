import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export function databaseIdentifier(name: string) {
  if (!/^fullstack_test_[a-f0-9]{24}$/.test(name)) throw new Error('Invalid test database identifier');
  return `"${name}"`;
}

export async function assertPortFree(port: number) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', () => reject(new Error(`Loopback port ${port} is occupied or unavailable`)));
    server.listen(port, '127.0.0.1', () => server.close((error) => error ? reject(error) : resolve()));
  });
}

export function startNode(label: string, args: string[], env: NodeJS.ProcessEnv, cwd = process.cwd()) {
  // Direct Node children: no shell, pnpm wrapper, or process-name termination.
  // Discard raw output because driver/CLI errors can contain connection strings.
  const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: 'ignore' });
  let ended = false;
  const exit = new Promise<number | null>((resolve) => {
    child.once('error', () => { ended = true; resolve(null); });
    child.once('close', (code) => { ended = true; resolve(code); });
  });
  return {
    label,
    async wait(timeout: number) {
      const code = await Promise.race([exit, delay(timeout, 'timeout', { ref: false })]);
      if (code !== 0) throw new Error(`${label} failed (${code === 'timeout' ? 'timeout' : `exit ${code}`})`);
    },
    async ready(url: string, status: number) {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (ended) throw new Error(`${label} exited before readiness`);
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
          await response.body?.cancel();
          if (response.status === status) return;
        } catch { /* Bounded retry while the owned service starts. */ }
        await delay(200);
      }
      throw new Error(`${label} readiness timed out`);
    },
    async stop() {
      if (!ended) child.kill('SIGTERM');
      if (await Promise.race([exit.then(() => true), delay(5000, false, { ref: false })])) return;
      child.kill('SIGKILL');
      if (!await Promise.race([exit.then(() => true), delay(5000, false, { ref: false })])) {
        throw new Error(`${label} did not exit during cleanup`);
      }
    },
  };
}

export async function cleanupAll(actions: Array<() => Promise<unknown>>) {
  let failed = false;
  for (const action of actions) {
    try { await action(); } catch { failed = true; }
  }
  if (failed) throw new Error('Full-stack cleanup failed; inspect owned test resources before rerunning');
}
