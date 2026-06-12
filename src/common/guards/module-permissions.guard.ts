import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ModuleKey, UserRole } from '../../prisma/client';
import {
  MODULE_PERMISSION_KEY,
  SKIP_MODULE_PERMISSION_KEY,
} from '../decorators/module-permission.decorator';
import { CurrentUser } from '../interfaces/current-user.interface';
import { UserPermissionsService } from '../services/user-permissions.service';

@Injectable()
export class ModulePermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly userPermissionsService: UserPermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_MODULE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) {
      return true;
    }

    const moduleKey = this.reflector.getAllAndOverride<ModuleKey>(
      MODULE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!moduleKey) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: CurrentUser; method: string }>();
    const user = request.user;
    if (!user) {
      return false;
    }

    if (user.role === UserRole.SUPERADMIN || user.role === UserRole.ADMIN) {
      return true;
    }

    const action = request.method === 'GET' ? 'view' : 'manage';
    const allowed = await this.userPermissionsService.can(
      user,
      moduleKey,
      action,
    );

    if (!allowed) {
      throw new ForbiddenException(
        `You do not have ${action} permission for the ${moduleKey.toLowerCase()} module. Ask your administrator for access.`,
      );
    }

    return true;
  }
}
