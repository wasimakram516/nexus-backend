import { Client } from 'pg';

/** What a database holds, in the terms a restore check compares. */
export interface DatabaseSnapshot {
  /** Row count per table in the public schema. */
  tableCounts: Record<string, number>;
  /** The names of the migrations that have been applied. */
  migrations: string[];
}

export interface VerificationResult {
  passed: boolean;
  /** One line per problem, or a single line saying what matched. */
  summary: string;
}

/**
 * Compares the live database with a copy restored from a backup. The live
 * database keeps changing after the dump, so a table may legitimately hold a
 * few more (or fewer) rows; a table that lost more than 5% of its rows, a
 * missing table, or a different set of migrations means the backup cannot be
 * trusted.
 *
 * @param {DatabaseSnapshot} source - The live database.
 * @param {DatabaseSnapshot} restored - The copy restored from the backup.
 * @returns {VerificationResult} Whether they agree, and why not.
 */
export function compareSnapshots(
  source: DatabaseSnapshot,
  restored: DatabaseSnapshot,
): VerificationResult {
  const problems: string[] = [];

  const missingMigrations = source.migrations.filter(
    (name) => !restored.migrations.includes(name),
  );
  // A migration applied after the dump is expected to be missing from it,
  // so only a restored migration the live database lacks is a mismatch.
  const unknownMigrations = restored.migrations.filter(
    (name) => !source.migrations.includes(name),
  );
  if (unknownMigrations.length > 0) {
    problems.push(
      `the backup has migrations the live database lacks: ${unknownMigrations.join(', ')}`,
    );
  }
  if (restored.migrations.length === 0) {
    problems.push('the backup has no migration history');
  } else if (missingMigrations.length > 5) {
    problems.push(
      `the backup lacks ${missingMigrations.length} migrations the live database has`,
    );
  }

  for (const [table, sourceCount] of Object.entries(source.tableCounts)) {
    const restoredCount = restored.tableCounts[table];
    if (restoredCount === undefined) {
      // A table created after the dump is not a fault of the backup.
      if (sourceCount > 0 && missingMigrations.length === 0) {
        problems.push(`table ${table} is missing from the backup`);
      }
      continue;
    }
    const allowedLoss = Math.max(1, Math.ceil(sourceCount * 0.05));
    if (restoredCount < sourceCount - allowedLoss) {
      problems.push(
        `table ${table} has ${restoredCount} rows in the backup but ${sourceCount} now`,
      );
    }
  }

  if (problems.length > 0) {
    return { passed: false, summary: problems.join('; ') };
  }
  const tables = Object.keys(restored.tableCounts).length;
  const rows = Object.values(restored.tableCounts).reduce(
    (sum, count) => sum + count,
    0,
  );
  return {
    passed: true,
    summary: `${tables} tables and ${rows} rows matched the live database.`,
  };
}

/** Reads and creates databases; a seam so the check can be tested without a server. */
export interface DatabaseInspector {
  snapshot(databaseUrl: string): Promise<DatabaseSnapshot>;
  createDatabase(adminUrl: string, name: string): Promise<string>;
  dropDatabase(adminUrl: string, name: string): Promise<void>;
}

/** Quotes a database name for use in a statement that cannot take parameters. */
function quoteIdentifier(name: string): string {
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error('Unsafe database name.');
  }
  return `"${name}"`;
}

/** The real thing, over a PostgreSQL connection. */
export class PgDatabaseInspector implements DatabaseInspector {
  private async withClient<T>(
    url: string,
    work: (client: Client) => Promise<T>,
  ): Promise<T> {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      return await work(client);
    } finally {
      await client.end();
    }
  }

  snapshot(databaseUrl: string): Promise<DatabaseSnapshot> {
    return this.withClient(databaseUrl, async (client) => {
      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
           AND table_name <> '_prisma_migrations'`,
      );
      const tableCounts: Record<string, number> = {};
      for (const { table_name: table } of tables.rows) {
        const result = await client.query<{ count: string }>(
          `SELECT count(*) FROM "${table.replace(/"/g, '""')}"`,
        );
        tableCounts[table] = Number(result.rows[0].count);
      }
      const migrations = await client
        .query<{ migration_name: string }>(
          `SELECT migration_name FROM _prisma_migrations
           WHERE finished_at IS NOT NULL ORDER BY migration_name`,
        )
        .then((result) => result.rows.map((row) => row.migration_name))
        .catch(() => [] as string[]);
      return { tableCounts, migrations };
    });
  }

  async createDatabase(adminUrl: string, name: string): Promise<string> {
    await this.withClient(adminUrl, (client) =>
      client.query(`CREATE DATABASE ${quoteIdentifier(name)}`),
    );
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    return url.toString();
  }

  async dropDatabase(adminUrl: string, name: string): Promise<void> {
    await this.withClient(adminUrl, (client) =>
      client.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)}`),
    );
  }
}
