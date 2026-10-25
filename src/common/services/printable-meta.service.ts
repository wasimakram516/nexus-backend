import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface PrintableMeta {
  /** e.g. 'DATESHEET' | 'ADMIT_CARD' | 'REPORT_CARD' | 'FEE_VOUCHER'. */
  documentType: string;
  generatedAt: string;
  /** The school's IANA timezone (the campus's when it has its own), for writing times. */
  timezone: string;
  institution: {
    id: string;
    name: string;
    logoUrl: string | null;
    branding: {
      primaryColorLight: string | null;
      secondaryColorLight: string | null;
      accentColorLight: string | null;
      backgroundColorLight: string | null;
      primaryColorDark: string | null;
      secondaryColorDark: string | null;
      accentColorDark: string | null;
      backgroundColorDark: string | null;
    };
  };
  campus: { id: string; name: string } | null;
}

/**
 * Builds the common header block every printable document attaches to its
 * response (datesheets, admit cards, report cards, and later fee vouchers).
 * Lives in `common/services` so Finance can depend on it without importing
 * the examinations module.
 */
@Injectable()
export class PrintableMetaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve institution identity, branding and (optionally) the campus for a
   * printable document.
   *
   * @param {string} documentType - Document kind the frontend print layout switches on.
   * @param {string} institutionId - Institution the document belongs to.
   * @param {string} [campusId] - Campus the document is for, when it has one.
   * @returns {Promise<PrintableMeta>} The shared print header.
   * @throws {NotFoundException} If the institution, or a campus of that institution, does not exist.
   */
  async build(
    documentType: string,
    institutionId: string,
    campusId?: string,
  ): Promise<PrintableMeta> {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: {
        id: true,
        name: true,
        timezone: true,
        branding: {
          select: {
            displayName: true,
            logoUrl: true,
            primaryColorLight: true,
            secondaryColorLight: true,
            accentColorLight: true,
            backgroundColorLight: true,
            primaryColorDark: true,
            secondaryColorDark: true,
            accentColorDark: true,
            backgroundColorDark: true,
          },
        },
      },
    });

    if (!institution) {
      throw new NotFoundException('Institution not found.');
    }

    let campus: PrintableMeta['campus'] = null;
    let campusTimezone: string | null = null;
    if (campusId) {
      const row = await this.prisma.campus.findUnique({
        where: { id: campusId },
        select: {
          id: true,
          name: true,
          institutionId: true,
          timezone: true,
        },
      });
      if (!row || row.institutionId !== institutionId) {
        throw new NotFoundException('Campus not found.');
      }
      campus = { id: row.id, name: row.name };
      campusTimezone = row.timezone;
    }

    const branding = institution.branding;
    return {
      documentType,
      generatedAt: new Date().toISOString(),
      timezone: campusTimezone ?? institution.timezone,
      institution: {
        id: institution.id,
        name: branding?.displayName || institution.name,
        logoUrl: branding?.logoUrl ?? null,
        branding: {
          primaryColorLight: branding?.primaryColorLight ?? null,
          secondaryColorLight: branding?.secondaryColorLight ?? null,
          accentColorLight: branding?.accentColorLight ?? null,
          backgroundColorLight: branding?.backgroundColorLight ?? null,
          primaryColorDark: branding?.primaryColorDark ?? null,
          secondaryColorDark: branding?.secondaryColorDark ?? null,
          accentColorDark: branding?.accentColorDark ?? null,
          backgroundColorDark: branding?.backgroundColorDark ?? null,
        },
      },
      campus,
    };
  }
}
