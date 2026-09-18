import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { CurrentUser } from '../../common/interfaces/current-user.interface';

describe('UsersController', () => {
  let controller: UsersController;
  let usersServiceMock: {
    getProfile: jest.Mock;
    updateProfile: jest.Mock;
    listUsers: jest.Mock;
    resolveUsers: jest.Mock;
    updateUserRole: jest.Mock;
    deleteUser: jest.Mock;
  };

  const currentUser: CurrentUser = {
    sub: 'user-1',
    email: 'user@nexus.test',
    role: 'ADMIN',
    institutionId: 'institution-1',
  };

  beforeEach(() => {
    usersServiceMock = {
      getProfile: jest.fn().mockResolvedValue({ id: 'user-1' }),
      updateProfile: jest.fn().mockResolvedValue({ id: 'user-1' }),
      listUsers: jest.fn().mockResolvedValue([]),
      resolveUsers: jest.fn().mockResolvedValue({}),
      updateUserRole: jest.fn().mockResolvedValue({ id: 'user-2' }),
      deleteUser: jest.fn().mockResolvedValue({ message: 'deleted' }),
    };
    controller = new UsersController(
      usersServiceMock as unknown as UsersService,
    );
  });

  it('returns the current user profile', async () => {
    await controller.getProfile(currentUser);
    expect(usersServiceMock.getProfile).toHaveBeenCalledWith(currentUser);
  });

  it('updates the current user profile', async () => {
    const dto = { name: 'Renamed' };
    await controller.updateProfile(currentUser, dto);
    expect(usersServiceMock.updateProfile).toHaveBeenCalledWith(
      currentUser,
      dto,
    );
  });

  it('lists users scoped to the caller institution', async () => {
    const query = { page: 1 };
    await controller.listUsers(currentUser, query);
    expect(usersServiceMock.listUsers).toHaveBeenCalledWith(currentUser, query);
  });

  it('resolves a comma-separated id list into trimmed, non-empty ids', async () => {
    await controller.resolveUsers(currentUser, {
      ids: ' user-2 ,user-3,,user-4 ',
    });
    expect(usersServiceMock.resolveUsers).toHaveBeenCalledWith(currentUser, [
      'user-2',
      'user-3',
      'user-4',
    ]);
  });

  it('updates a user access state', async () => {
    const dto = { role: 'TEACHER' };
    await controller.updateUser(currentUser, 'user-2', dto as never);
    expect(usersServiceMock.updateUserRole).toHaveBeenCalledWith(
      currentUser,
      'user-2',
      dto,
    );
  });

  it('soft-deletes a user with the provided reason', async () => {
    await controller.deleteUser(currentUser, 'user-2', {
      reason: 'Left the institution',
    });
    expect(usersServiceMock.deleteUser).toHaveBeenCalledWith(
      currentUser,
      'user-2',
      'Left the institution',
    );
  });
});
