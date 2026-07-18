import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
  Version,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { REFRESH_TOKEN_COOKIE } from '../../common/constants/auth.constants';
import { CurrentUserDecorator } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto, RevokeSessionDto } from './dto/auth.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Version('1')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('users', 'create')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Register a new user account',
    description:
      'Creates a new user account. SUPERADMIN/ADMIN always allowed; a STAFF user needs an explicit `users.create` grant, and can never create admin-level accounts.',
  })
  register(
    @Body() dto: RegisterDto,
    @CurrentUserDecorator() currentUser: CurrentUser,
  ) {
    return this.authService.register(dto, currentUser);
  }

  @Post('login')
  @Version('1')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Log in with identifier and password',
    description:
      'Accepts email (staff/admin), registration number (student), or phone (guardian) as the identifier. Returns the authenticated user context and sets the refresh-token cookie used by the refresh endpoint.',
  })
  login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.login(dto, res, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
  }

  @Post('refresh')
  @Version('1')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiCookieAuth('refreshToken')
  @ApiOperation({
    summary: 'Refresh the access token',
    description:
      'Uses the refresh-token cookie to issue a new access token and rotate the refresh session when applicable.',
  })
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.authService.refresh(
      req.cookies[REFRESH_TOKEN_COOKIE] as string | undefined,
      res,
    );
  }

  @Post('logout')
  @Version('1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Log out the current session',
    description:
      'Revokes the active refresh session for the authenticated user and clears the refresh-token cookie.',
  })
  logout(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.logout(currentUser, res, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
  }

  @Get('sessions')
  @Version('1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List active sessions',
    description:
      'Returns the authenticated user’s currently active refresh sessions for account-security UI flows.',
  })
  getSessions(@CurrentUserDecorator() currentUser: CurrentUser) {
    return this.authService.getSessions(currentUser);
  }

  @Post('sessions/revoke')
  @Version('1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Revoke a specific session',
    description:
      'Ends a selected refresh session for the authenticated user without logging out every other session.',
  })
  revokeSession(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: RevokeSessionDto,
  ) {
    return this.authService.revokeSession(currentUser, dto.sessionId);
  }
}
