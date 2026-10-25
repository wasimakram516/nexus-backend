import { Injectable } from '@nestjs/common';
import { CustomFieldInputType } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface PrintableCustomValue {
  label: string;
  value: string;
}

/** Files and images are not text, so they never print. */
const NOT_PRINTABLE = new Set<CustomFieldInputType>([
  CustomFieldInputType.FILE,
  CustomFieldInputType.IMAGE,
]);

/** A stored value as plain text; anything that is not a string, number or boolean has no text. */
function asText(value: unknown): string {
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
    ? String(value)
    : '';
}

interface OptionLike {
  label?: unknown;
  value?: unknown;
}

/**
 * The custom field values an institution has chosen to show on a printed
 * document: only fields flagged "show on print" and still active, in the
 * institution's own order, written the way a reader expects (a choice by its
 * label, a yes or no, a date without a time).
 */
@Injectable()
export class PrintableCustomValuesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The printable values of several records of one kind in one query pair.
   *
   * @param {string} institutionId - The institution the records belong to.
   * @param {string} entityType - The kind of record, such as `fee_voucher` or `exam`.
   * @param {string[]} entityIds - The records to read.
   * @returns {Promise<Map<string, PrintableCustomValue[]>>} Lines by record id; a record with none maps to an empty list.
   */
  async forRecords(
    institutionId: string,
    entityType: string,
    entityIds: string[],
  ): Promise<Map<string, PrintableCustomValue[]>> {
    const result = new Map<string, PrintableCustomValue[]>(
      entityIds.map((id) => [id, []]),
    );
    if (entityIds.length === 0) return result;

    const definitions = await this.prisma.customFieldDefinition.findMany({
      where: { institutionId, entityType, showOnPrint: true, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const printable = definitions.filter(
      (definition) => !NOT_PRINTABLE.has(definition.inputType),
    );
    if (printable.length === 0) return result;

    const values = await this.prisma.customFieldValue.findMany({
      where: {
        institutionId,
        entityId: { in: entityIds },
        definitionId: { in: printable.map((definition) => definition.id) },
      },
      select: { definitionId: true, entityId: true, value: true },
    });
    const byRecord = new Map<string, Map<string, unknown>>();
    for (const row of values) {
      const inner = byRecord.get(row.entityId) ?? new Map<string, unknown>();
      inner.set(row.definitionId, row.value);
      byRecord.set(row.entityId, inner);
    }

    for (const entityId of entityIds) {
      const stored = byRecord.get(entityId);
      if (!stored) continue;
      const lines: PrintableCustomValue[] = [];
      for (const definition of printable) {
        const text = this.format(
          stored.get(definition.id),
          definition.inputType,
          definition.options,
        );
        if (text) lines.push({ label: definition.label, value: text });
      }
      result.set(entityId, lines);
    }
    return result;
  }

  /** A stored value as text, or an empty string when there is nothing to show. */
  private format(
    value: unknown,
    inputType: CustomFieldInputType,
    options: unknown,
  ): string {
    if (value === null || value === undefined || value === '') return '';
    const labelOf = (raw: unknown) => {
      const match = (
        Array.isArray(options) ? (options as OptionLike[]) : []
      ).find((option) => option.value === raw);
      return typeof match?.label === 'string' ? match.label : asText(raw);
    };
    if (Array.isArray(value)) {
      return value
        .map((item) => labelOf(item))
        .filter(Boolean)
        .join(', ');
    }
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (inputType === CustomFieldInputType.DATE) {
      return asText(value).slice(0, 10);
    }
    if (inputType === CustomFieldInputType.DATETIME) {
      return asText(value).replace('T', ' ').slice(0, 16);
    }
    if (
      inputType === CustomFieldInputType.SELECT ||
      inputType === CustomFieldInputType.RADIO
    ) {
      return labelOf(value);
    }
    return asText(value);
  }
}
