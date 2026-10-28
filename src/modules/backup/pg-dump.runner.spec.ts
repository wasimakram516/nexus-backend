import { dumpDatabase, pgEnvFromUrl, runCommand } from './pg-dump.runner';

describe('pgEnvFromUrl', () => {
  it('splits a URL into the variables pg_dump reads, decoding the password', () => {
    expect(
      pgEnvFromUrl(
        'postgresql://nexus:p%40ss%2Fword@db.example.com:6543/Nexus',
      ),
    ).toEqual({
      PGHOST: 'db.example.com',
      PGPORT: '6543',
      PGDATABASE: 'Nexus',
      PGUSER: 'nexus',
      PGPASSWORD: 'p@ss/word',
    });
  });

  it('defaults the port and passes the ssl mode through', () => {
    const env = pgEnvFromUrl('postgres://u:p@host/db?sslmode=require');

    expect(env.PGPORT).toBe('5432');
    expect(env.PGSSLMODE).toBe('require');
  });

  it('rejects anything that is not a PostgreSQL URL or names no database', () => {
    expect(() => pgEnvFromUrl('mysql://u:p@host/db')).toThrow(
      'not a PostgreSQL',
    );
    expect(() => pgEnvFromUrl('postgresql://u:p@host')).toThrow('no database');
  });
});

describe('dumpDatabase', () => {
  it('asks pg_dump for a custom format dump, with the password in the environment and not on the command line', async () => {
    const run = jest.fn().mockResolvedValue(undefined);

    await dumpDatabase('postgresql://u:secret@host/db', '/tmp/x.dump', run);

    expect(run).toHaveBeenCalledWith(
      'pg_dump',
      ['--format=custom', '--no-owner', '--file', '/tmp/x.dump'],
      expect.objectContaining({ PGPASSWORD: 'secret', PGDATABASE: 'db' }),
    );
    const args = (run.mock.calls[0] as [string, string[]])[1];
    expect(args.join(' ')).not.toContain('secret');
  });
});

describe('runCommand', () => {
  it('resolves when the program succeeds', async () => {
    await expect(
      runCommand(process.execPath, ['-e', 'process.exit(0)'], {}),
    ).resolves.toBeUndefined();
  });

  it('fails with the exit code and error output when it does not', async () => {
    await expect(
      runCommand(
        process.execPath,
        ['-e', 'console.error("no such table"); process.exit(3)'],
        {},
      ),
    ).rejects.toThrow(/exited with 3: no such table/);
  });

  it('fails clearly when the program is not installed', async () => {
    await expect(
      runCommand('definitely-not-a-real-program', [], {}),
    ).rejects.toThrow('Could not start definitely-not-a-real-program');
  });
});
