import { Body, Controller, Get, Post, Req, Res, Version } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { PublicSignupDto } from './dto/signup.dto';
import { PlatformService } from './platform.service';
import { SignupService } from './signup.service';

@ApiTags('Platform')
@Controller('platform')
export class PlatformPublicController {
  constructor(
    private readonly platformService: PlatformService,
    private readonly signupService: SignupService,
  ) {}

  @Get('plans')
  @Version('1')
  @ApiOperation({
    summary: 'List public plan definitions',
    description:
      'Public endpoint for pricing or onboarding screens to read active plan information without authentication.',
  })
  listPlans() {
    return this.platformService.listPlans();
  }

  @Post('signup')
  @Version('1')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Self-signup for a free trial',
    description:
      'Public endpoint that creates a trial institution with its first admin account and logs the admin in immediately.',
  })
  signup(
    @Body() dto: PublicSignupDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.signupService.signup(dto, res, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
  }
}
