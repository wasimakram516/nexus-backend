import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { ModuleAccessService } from '../common/services/module-access.service';
import { RequestContextService } from '../common/services/request-context.service';
import { TimezoneResolverService } from '../common/services/timezone-resolver.service';
import { PlatformService } from '../modules/platform/platform.service';
import { PrismaService } from '../prisma/prisma.service';
import { DemoSeeder } from './demo-seed/demo-seeder';
import { DEMO_REG_PREFIX, demoPhone } from './demo-seed/demo-data';

const USAGE = `Creates a demo school with sample data (two campuses, students, guardians, staff,
attendance, fees, exams and payroll). It only adds a new school; it never changes or
removes anything that exists.

  npm run seed:demo -- --yes [--password <password>]

  --yes        Required. Confirms you mean to add the demo school to the database shown above.
  --password   The password every demo account signs in with. Generated when left out.`;

/** The database host and name, without the credentials, so the person can see where this will write. */
function describeTarget(connection: string | undefined): string {
  if (!connection) return '(DATABASE_URL is not set)';
  try {
    const url = new URL(connection);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return '(DATABASE_URL could not be read)';
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  console.log(`Target database: ${describeTarget(process.env.DATABASE_URL)}`);
  if (!process.env.DATABASE_URL) {
    console.error('Set DATABASE_URL first.');
    return 1;
  }
  if (!args.includes('--yes')) {
    console.log(`\nNothing was written.\n\n${USAGE}`);
    return 1;
  }
  const given = args.indexOf('--password');
  const password =
    given >= 0 && args[given + 1]
      ? args[given + 1]
      : randomBytes(9).toString('base64url');
  if (password.length < 8) {
    console.error('The password must be at least 8 characters.');
    return 1;
  }

  const requestContext = new RequestContextService();
  const prisma = new PrismaService(requestContext);
  try {
    // Creating an institution does not touch module access, so a bare stand-in is enough here.
    const platform = new PlatformService(
      prisma,
      {} as ModuleAccessService,
      requestContext,
      { get: () => undefined } as unknown as ConfigService,
      new TimezoneResolverService(prisma),
    );
    const summary = await new DemoSeeder(prisma, platform).run({
      passwordHash: await bcrypt.hash(password, 12),
    });

    console.log('\nDemo school created.\n');
    console.log(`  School id     ${summary.institutionId}`);
    console.log(`  Slug          ${summary.slug}`);
    console.log(`  Admin sign-in ${summary.adminEmail}`);
    console.log(`  Student       registration number ${DEMO_REG_PREFIX}0001`);
    console.log(`  Guardian      phone ${demoPhone(0)}`);
    console.log(
      `  Password      ${password}   (the same for every demo account)`,
    );
    console.log(`  Created       ${JSON.stringify(summary.counts)}`);
    return 0;
  } catch (error) {
    console.error(
      `\nThe demo school was not completed: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(
      'If part of it was created, remove the "demo-school" institution from the platform console before running this again. Nothing was deleted automatically.',
    );
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main().then((code) => {
  process.exitCode = code;
});
