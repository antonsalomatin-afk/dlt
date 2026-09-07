export function parseDatabaseUrl(value: string | undefined) {
  try {
    const url = new URL(value ?? '');
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    const database = decodeURIComponent(url.pathname.slice(1));
    if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1'
      || !/^\d+$/.test(url.port) || Number(url.port) < 1024 || Number(url.port) > 65535
      || !/^[a-z][a-z0-9_]{0,62}$/.test(user)
      || !/^[a-z][a-z0-9_]{0,62}$/.test(database)
      || !password || /[\r\n\0]/.test(password) || url.search || url.hash) {
      throw new Error();
    }
    return { user, password, database, port: url.port };
  } catch {
    throw new Error('DATABASE_URL must specify postgresql://user:password@127.0.0.1:port/database (port 1024-65535; lowercase identifiers; no query or fragment).');
  }
}
