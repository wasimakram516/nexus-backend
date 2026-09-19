import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ContactInquiryStatus } from '../../prisma/client';
import { UserRole } from '../../common/enums/domain.enums';
import { APP_VALIDATION_PIPE_OPTIONS } from '../../common/constants/validation.constants';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import {
  ContactInquiriesAdminController,
  ContactInquiriesPublicController,
} from './contact-inquiries.controller';
import { ContactInquiriesService } from './contact-inquiries.service';
import {
  CreateContactInquiryDto,
  ListContactInquiriesQueryDto,
} from './dto/contact-inquiry.dto';

const pipe = new ValidationPipe(APP_VALIDATION_PIPE_OPTIONS);
const validate = <T>(
  type: new () => T,
  value: unknown,
  kind: 'body' | 'query',
) => pipe.transform(value, { type: kind, metatype: type });

const valid = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  inquiryType: 'Request a Demo',
  message: 'Hello there',
};

describe('ContactInquiries controllers', () => {
  const service = {
    create: jest.fn().mockResolvedValue({ message: 'ok', data: null }),
    list: jest.fn(),
    updateStatus: jest.fn(),
    remove: jest.fn(),
  };
  const reflector = new Reflector();

  beforeEach(() => jest.clearAllMocks());

  describe('create DTO validation (app ValidationPipe options)', () => {
    it('accepts a valid payload and sanitises control chars', async () => {
      const out = (await validate(
        CreateContactInquiryDto,
        {
          ...valid,
          name: '  Ada\u0000\u0007  ',
          message: 'Line1\nLine2\u001b',
        },
        'body',
      )) as CreateContactInquiryDto;
      expect(out.name).toBe('Ada');
      expect(out.message).toBe('Line1\nLine2');
    });

    it.each([
      ['bad email', { email: 'nope' }],
      ['unknown type', { inquiryType: 'Spam' }],
      ['empty name', { name: '   ' }],
      ['long name', { name: 'a'.repeat(121) }],
      ['long message', { message: 'a'.repeat(5001) }],
      ['unknown field', { role: 'SUPERADMIN' }],
    ])('rejects %s', async (_label, patch) => {
      await expect(
        validate(CreateContactInquiryDto, { ...valid, ...patch }, 'body'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts boundary lengths', async () => {
      await expect(
        validate(
          CreateContactInquiryDto,
          {
            ...valid,
            name: 'a'.repeat(120),
            message: 'a'.repeat(5000),
            organisation: 'o'.repeat(160),
          },
          'body',
        ),
      ).resolves.toBeDefined();
    });

    it('accepts the honeypot field so it reaches the service', async () => {
      const out = (await validate(
        CreateContactInquiryDto,
        { ...valid, website: 'x' },
        'body',
      )) as CreateContactInquiryDto;
      expect(out.website).toBe('x');
    });
  });

  describe('list query validation', () => {
    it('coerces numbers and rejects bad status / limit', async () => {
      const out = (await validate(
        ListContactInquiriesQueryDto,
        { page: '2', limit: '20', status: 'READ' },
        'query',
      )) as ListContactInquiriesQueryDto;
      expect(out).toMatchObject({ page: 2, limit: 20, status: 'READ' });
      await expect(
        validate(ListContactInquiriesQueryDto, { status: 'BAD' }, 'query'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        validate(ListContactInquiriesQueryDto, { limit: '101' }, 'query'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('public controller', () => {
    it('passes ip and user agent to the service', async () => {
      const ctrl = new ContactInquiriesPublicController(
        service as unknown as ContactInquiriesService,
      );
      await ctrl.create(valid, {
        ip: '9.9.9.9',
        headers: { 'user-agent': 'ua' },
      } as never);
      expect(service.create).toHaveBeenCalledWith(valid, {
        ipAddress: '9.9.9.9',
        userAgent: 'ua',
      });
    });

    it('is unauthenticated and rate limited to 5/min', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, ContactInquiriesPublicController),
      ).toBeUndefined();
      expect(
        Reflect.getMetadata(
          'THROTTLER:LIMITdefault',
          // eslint-disable-next-line @typescript-eslint/unbound-method
          ContactInquiriesPublicController.prototype.create,
        ),
      ).toBe(5);
    });
  });

  describe('admin controller', () => {
    it('is guarded by JWT + roles and restricted to SUPERADMIN', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, ContactInquiriesAdminController),
      ).toEqual([JwtAuthGuard, RolesGuard]);
      expect(reflector.get('roles', ContactInquiriesAdminController)).toEqual([
        UserRole.SUPERADMIN,
      ]);
    });

    it('delegates list, status and delete', async () => {
      const ctrl = new ContactInquiriesAdminController(
        service as unknown as ContactInquiriesService,
      );
      const user = { sub: 'u' } as CurrentUser;
      await ctrl.list({});
      await ctrl.updateStatus('id', { status: ContactInquiryStatus.READ });
      await ctrl.remove('id', user, { reason: 'spam' });
      expect(service.list).toHaveBeenCalled();
      expect(service.updateStatus).toHaveBeenCalledWith(
        'id',
        ContactInquiryStatus.READ,
      );
      expect(service.remove).toHaveBeenCalledWith('id', user, 'spam');
    });
  });
});
