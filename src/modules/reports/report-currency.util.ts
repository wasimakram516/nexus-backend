import { readFinanceSettings } from '../../common/utils/finance-settings.util';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The label a school uses for its money (such as PKR), so a report can say what
 * its amounts are in.
 *
 * @param {PrismaService} prisma - The database.
 * @param {string} institutionId - The school.
 * @returns {Promise<string>} The currency label, or the default when none is set.
 */
export async function reportCurrency(
  prisma: PrismaService,
  institutionId: string,
): Promise<string> {
  const setting = await prisma.institutionSetting.findFirst({
    where: { institutionId, key: 'finance' },
    select: { value: true },
  });
  return readFinanceSettings(setting?.value).currencyLabel;
}
