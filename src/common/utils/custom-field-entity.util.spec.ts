import { CustomFieldEntity } from '../constants/custom-field-entities.constants';
import { normalizeCustomFieldEntity } from './custom-field-entity.util';
import {
  assertCustomFieldEntityModule,
  CUSTOM_FIELD_ENTITY_MODULES,
} from './custom-field-entity.util';
import { ModuleKey } from '../../prisma/client';

describe('normalizeCustomFieldEntity', () => {
  it.each(Object.values(CustomFieldEntity))(
    'resolves canonical and legacy names for %s',
    (entity) => {
      expect(normalizeCustomFieldEntity(entity)).toBe(entity);
      expect(
        assertCustomFieldEntityModule(
          entity.toUpperCase(),
          CUSTOM_FIELD_ENTITY_MODULES[entity],
        ),
      ).toBe(entity);
      expect(normalizeCustomFieldEntity(` ${entity.toUpperCase()} `)).toBe(
        entity,
      );
    },
  );
  it('rejects unsupported entities', () => {
    expect(() => normalizeCustomFieldEntity('unknown')).toThrow('Unsupported');
  });
  it('rejects definitions in a module the record service does not read', () => {
    expect(() =>
      assertCustomFieldEntityModule('student', ModuleKey.FINANCE),
    ).toThrow('belong to PEOPLE');
  });
});
