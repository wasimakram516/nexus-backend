import { collectReferenceIds, resolveReferenceNames } from './audit-references';

const ADMIN = '4f25b912-60f8-4382-a02e-03b8a4c62f52';
const YEAR = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-2222-3333-4444-555555555555';

describe('audit reference names', () => {
  it('groups the ids found in snapshots by the model that names them', () => {
    const wanted = collectReferenceIds([
      { deletedBy: ADMIN, currentAcademicYearId: YEAR, notes: OTHER },
      { updatedBy: ADMIN, name: 'x', unknownId: OTHER },
      null,
    ]);

    expect(Array.from(wanted.get('user') ?? [])).toEqual([ADMIN]);
    expect(Array.from(wanted.get('academicYear') ?? [])).toEqual([YEAR]);
    expect(wanted.size).toBe(2);
  });

  it('ignores values that are not ids', () => {
    expect(collectReferenceIds([{ deletedBy: 'not-an-id' }]).size).toBe(0);
  });

  it('looks each model up once and maps id to name', async () => {
    const user = {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: ADMIN, name: 'Naeem Akhtar' }]),
    };
    const academicYear = {
      findMany: jest.fn().mockResolvedValue([{ id: YEAR, name: '2026-27' }]),
    };

    const names = await resolveReferenceNames({ user, academicYear } as never, [
      { deletedBy: ADMIN },
      { updatedBy: ADMIN, currentAcademicYearId: YEAR },
    ]);

    expect(names).toEqual({ [ADMIN]: 'Naeem Akhtar', [YEAR]: '2026-27' });
    expect(user.findMany).toHaveBeenCalledTimes(1);
    expect(user.findMany).toHaveBeenCalledWith({
      where: { id: { in: [ADMIN] } },
      select: { id: true, name: true },
    });
  });

  it('does no lookup when there is nothing to resolve', async () => {
    const user = { findMany: jest.fn() };

    expect(
      await resolveReferenceNames({ user } as never, [{ name: 'x' }]),
    ).toEqual({});
    expect(user.findMany).not.toHaveBeenCalled();
  });
});
