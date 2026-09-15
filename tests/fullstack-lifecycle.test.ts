import { createServer } from 'node:net';
import { expect, it } from 'vitest';
import { assertPortFree, cleanupAll, databaseIdentifier, startNode } from './fullstack/lifecycle.ts';

it('only quotes the exact random test database format', () => {
  expect(databaseIdentifier(`fullstack_test_${'a'.repeat(24)}`)).toBe(`"fullstack_test_${'a'.repeat(24)}"`);
  for (const name of ['postgres', 'fullstack_test_', 'fullstack_test_"; DROP DATABASE postgres;--']) {
    expect(() => databaseIdentifier(name)).toThrow('Invalid test database identifier');
  }
});

it('rejects an occupied port without stopping its listener', async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test listener');
    await expect(assertPortFree(address.port)).rejects.toThrow('occupied or unavailable');
    expect(server.listening).toBe(true);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

it('runs every cleanup after partial setup failures and propagates failure', async () => {
  const calls: number[] = [];
  await expect(cleanupAll([
    async () => { calls.push(1); throw new Error('simulated cleanup failure'); },
    async () => { calls.push(2); },
  ])).rejects.toThrow('cleanup failed');
  expect(calls).toEqual([1, 2]);
});

it('reports failed children and stops only an owned running child after timeout', async () => {
  const failed = startNode('Failure probe', ['-e', 'process.exit(3)'], process.env);
  const running = startNode('Timeout probe', ['-e', 'setInterval(() => {}, 1000)'], process.env);
  try {
    await expect(failed.wait(5000)).rejects.toThrow('exit 3');
    await expect(running.wait(10)).rejects.toThrow('timeout');
  } finally { await cleanupAll([() => failed.stop(), () => running.stop()]); }
  await running.stop();
});
