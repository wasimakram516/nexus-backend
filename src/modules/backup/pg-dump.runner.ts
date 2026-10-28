import { spawn } from 'child_process';

/**
 * The connection details from a database URL, as the PG* variables that
 * `pg_dump` reads. Passing them this way keeps the password out of the process
 * list, where a command line argument would show it to every user on the machine.
 *
 * @param {string} databaseUrl - A `postgresql://user:password@host:port/database` URL.
 * @returns {Record<string, string>} The environment variables to give `pg_dump`.
 * @throws {Error} When the URL is not a PostgreSQL URL.
 */
export function pgEnvFromUrl(databaseUrl: string): Record<string, string> {
  const url = new URL(databaseUrl);
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    throw new Error('The database URL is not a PostgreSQL URL.');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new Error('The database URL names no database.');
  const env: Record<string, string> = {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: database,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
  };
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

/** Runs a program to completion; a seam so the backup job can be tested without PostgreSQL installed. */
export type CommandRunner = (
  command: string,
  args: string[],
  env: Record<string, string>,
) => Promise<void>;

/** Starts a real process and fails with its error output when it exits badly. */
export const runCommand: CommandRunner = (command, args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.on('error', (error) =>
      reject(new Error(`Could not start ${command}: ${error.message}`)),
    );
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`)),
    );
  });

/**
 * Takes a whole-database dump in PostgreSQL's custom format (restorable with
 * `pg_restore`, selectively if needed).
 *
 * @param {string} databaseUrl - The database to dump.
 * @param {string} outputPath - Where to write the dump.
 * @param {CommandRunner} [run] - How to run the program; the real one by default.
 * @returns {Promise<void>} Resolves when the dump is complete.
 */
export async function dumpDatabase(
  databaseUrl: string,
  outputPath: string,
  run: CommandRunner = runCommand,
): Promise<void> {
  await run(
    'pg_dump',
    ['--format=custom', '--no-owner', '--file', outputPath],
    pgEnvFromUrl(databaseUrl),
  );
}
