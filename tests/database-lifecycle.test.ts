import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../', import.meta.url));
let sandbox: string;
beforeEach(() => {
  sandbox = mkdtempSync(join(repo, 'tests/db-safety-'));
  mkdirSync(join(sandbox, 'tools'));
  cpSync(join(repo, 'tools/database'), join(sandbox, 'tools/database'), { recursive: true });
});
afterEach(() => rmSync(sandbox, { recursive: true, force: true }));

function reset(url = 'postgresql://thaidlt:local-only@127.0.0.1:55432/thaidlt') {
  return spawnSync(process.execPath, [join(sandbox, 'tools/database/local.ts'), 'reset'], {
    env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 10000, windowsHide: true,
  });
}

describe('local database reset safety', () => {
  it('rejects invalid configuration without printing credentials', () => {
    const result = reset('postgresql://user:secret-value@example.com:55432/db');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DATABASE_URL must specify');
    expect(result.stderr).not.toContain('secret-value');
  });
  it('preserves an unmanaged directory', () => {
    const data = join(sandbox, '.local-postgres');
    mkdirSync(data);
    writeFileSync(join(data, 'keep'), 'untouched');
    const result = reset();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Refusing unmanaged');
    expect(readFileSync(join(data, 'keep'), 'utf8')).toBe('untouched');
  });
  it('refuses a directory junction instead of deleting its target', () => {
    const target = join(sandbox, 'outside');
    mkdirSync(target);
    writeFileSync(join(target, 'owner'), 'ThaiDLT local PostgreSQL v1\n');
    symlinkSync(target, join(sandbox, '.local-postgres'), 'junction');
    const result = reset();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Refusing unmanaged');
    expect(existsSync(join(target, 'owner'))).toBe(true);
  });
  it('removes only the owned uninitialized development directory', () => {
    const data = join(sandbox, '.local-postgres');
    mkdirSync(data);
    writeFileSync(join(data, 'owner'), 'ThaiDLT local PostgreSQL v1\n');
    writeFileSync(join(sandbox, 'keep'), 'untouched');
    expect(reset().status).toBe(0);
    expect(existsSync(data)).toBe(false);
    expect(readFileSync(join(sandbox, 'keep'), 'utf8')).toBe('untouched');
  });
});
