import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDatabaseUrl } from './config.ts';
import pg from 'pg';

const root = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const data = join(root, '.local-postgres');
const cluster = join(data, 'cluster');
const marker = join(data, 'owner');
const owner = 'ThaiDLT local PostgreSQL v1\n';

function verifyData() {
  if (!existsSync(data)) return;
  if (lstatSync(data).isSymbolicLink() || realpathSync(data) !== resolve(data)
    || !existsSync(marker) || lstatSync(marker).isSymbolicLink()
    || readFileSync(marker, 'utf8') !== owner
    || (existsSync(cluster) && (lstatSync(cluster).isSymbolicLink() || realpathSync(cluster) !== resolve(cluster)))) {
    throw new Error('Refusing unmanaged or redirected local PostgreSQL directory.');
  }
}

async function main() {
  const command = process.argv[2];
  if (!['start', 'ready', 'stop', 'reset'].includes(command ?? '')) {
    throw new Error('Expected start, ready, stop, or reset.');
  }
  const config = parseDatabaseUrl(process.env.DATABASE_URL);
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('This native development runner currently supports Windows x64.');
  }
  const require = createRequire(import.meta.resolve('embedded-postgres'));
  const bin = resolve(dirname(require.resolve('@embedded-postgres/windows-x64')), '../native/bin');
  function run(name: string, args: string[]) {
    const result = spawnSync(join(bin, `${name}.exe`), args, {
      encoding: 'utf8', windowsHide: true, timeout: 60000, stdio: 'ignore',
      env: { ...process.env, PGPASSWORD: config.password, PGCONNECT_TIMEOUT: '5' },
    });
    if (result.error || result.signal) throw new Error(`${name} could not complete.`);
    return result;
  }
  function checked(name: string, args: string[]) {
    const result = run(name, args);
    if (result.status !== 0) throw new Error(`${name} failed (exit ${result.status}); check local configuration and port availability.`);
  }
  async function query(database: string, sql: string, parameters: string[] = []) {
    const client = new pg.Client({
      host: '127.0.0.1', port: Number(config.port), user: config.user,
      password: config.password, database, connectionTimeoutMillis: 5000,
      query_timeout: 5000, statement_timeout: 5000,
    });
    try {
      await client.connect();
      return await client.query(sql, parameters);
    } catch {
      throw new Error('Local PostgreSQL connection or query failed; check configuration and readiness.');
    } finally {
      await client.end();
    }
  }
  verifyData();
  if (command === 'ready') {
    await query(config.database, 'SELECT 1');
  } else if (command === 'start') {
    if (!existsSync(data)) {
      mkdirSync(data);
      writeFileSync(marker, owner, { flag: 'wx' });
    }
    if (!existsSync(join(cluster, 'PG_VERSION'))) {
      const passwordFile = join(data, 'init-password');
      writeFileSync(passwordFile, `${config.password}\n`, { flag: 'wx', mode: 0o600 });
      try {
        checked('initdb', ['-D', cluster, '-U', config.user, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C', `--pwfile=${passwordFile}`]);
      } finally {
        rmSync(passwordFile);
      }
    }
    const status = run('pg_ctl', ['-D', cluster, 'status']).status;
    if (status === 3) {
      checked('pg_ctl', ['-D', cluster, '-l', join(data, 'server.log'), '-o', `-h 127.0.0.1 -p ${config.port}`, '-w', '-t', '30', 'start']);
    } else if (status !== 0) throw new Error('Cannot determine local PostgreSQL status.');
    const databases = await query('postgres', 'SELECT 1 FROM pg_database WHERE datname = $1', [config.database]);
    if (databases.rowCount === 0) {
      // PostgreSQL cannot parameterize identifiers; config restricts this to lowercase letters/digits/underscores.
      await query('postgres', `CREATE DATABASE "${config.database}"`);
    }
    await query(config.database, 'SELECT 1');
  } else if (existsSync(data)) {
    if (existsSync(join(cluster, 'PG_VERSION'))) {
      const status = run('pg_ctl', ['-D', cluster, 'status']).status;
      if (status === 0) checked('pg_ctl', ['-D', cluster, '-m', 'fast', '-w', '-t', '30', 'stop']);
      else if (status !== 3) throw new Error('Cannot determine local PostgreSQL status; refusing removal.');
    }
    if (command === 'reset') {
      verifyData();
      rmSync(data, { recursive: true });
    }
  }
  console.log(`Local PostgreSQL ${command}: OK`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Local PostgreSQL command failed.');
  process.exitCode = 1;
}
