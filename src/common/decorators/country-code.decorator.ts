import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { COUNTRY_CODE_LIST } from '../utils/phone.util';

/**
 * An optional ISO country code field such as `PK` or `AE`, accepted in any
 * case and stored upper-cased. Anything that is not a real country is refused.
 *
 * @param {string} description - What the country means for this field.
 * @returns {PropertyDecorator} The combined decorator.
 */
export function CountryCodeField(description: string): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({ description }),
    IsOptional(),
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.toUpperCase() : value,
    ),
    IsIn(COUNTRY_CODE_LIST),
  );
}
