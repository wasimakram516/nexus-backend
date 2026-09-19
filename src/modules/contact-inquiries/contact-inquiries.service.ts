import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ContactInquiryStatus, Prisma } from '../../prisma/client';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import {
  INQUIRY_CREATED_EVENT,
  SUPERADMIN_ROOM,
} from '../realtime/realtime.constants';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  CreateContactInquiryDto,
  ListContactInquiriesQueryDto,
} from './dto/contact-inquiry.dto';

@Injectable()
export class ContactInquiriesService {
  private readonly logger = new Logger(ContactInquiriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Stores a public inquiry. A filled honeypot is silently dropped while
   * returning the same success payload, so bots get no signal.
   * @param {CreateContactInquiryDto} dto Validated submission.
   * @param {{ipAddress?: string, userAgent?: string}} meta Request metadata.
   * @returns {Promise<{message: string, data: null}>} Standard success payload.
   */
  async create(
    dto: CreateContactInquiryDto,
    meta: { ipAddress?: string; userAgent?: string },
  ) {
    const result = { message: 'Message received. Thank you.', data: null };
    if (dto.website && dto.website.trim().length > 0) {
      // Never silent for us: a real visitor whose browser autofilled the hidden
      // field would otherwise vanish without a trace.
      this.logger.warn(
        `Dropped inquiry: honeypot field was filled (ip=${meta.ipAddress ?? 'unknown'}, type=${dto.inquiryType})`,
      );
      return result;
    }
    const created = await this.prisma.contactInquiry.create({
      data: {
        name: dto.name,
        email: dto.email,
        organisation: dto.organisation || null,
        inquiryType: dto.inquiryType,
        message: dto.message,
        ipAddress: meta.ipAddress?.slice(0, 64) ?? null,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
      },
    });
    this.notifySuperadmins(created);
    return result;
  }

  /**
   * Best-effort live alert with a minimal payload (no email/message/IP).
   * Never throws: a realtime failure must not affect the HTTP request.
   * @param {{id: string, name: string, inquiryType: string, createdAt: Date}} row Stored inquiry.
   * @returns {void}
   */
  private notifySuperadmins(row: {
    id: string;
    name: string;
    inquiryType: string;
    createdAt: Date;
  }): void {
    try {
      this.realtime.emitDomainEvent(SUPERADMIN_ROOM, INQUIRY_CREATED_EVENT, {
        id: row.id,
        name: row.name,
        inquiryType: row.inquiryType,
        createdAt: row.createdAt,
      });
    } catch (error) {
      this.logger.warn(
        `Inquiry realtime emit failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Lists inquiries (newest first) with optional status filter.
   * @param {ListContactInquiriesQueryDto} query Pagination and filter.
   * @returns {Promise<object>} Paginated items with total, page, limit.
   */
  async list(query: ListContactInquiriesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const where: Prisma.ContactInquiryWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.contactInquiry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.contactInquiry.count({ where }),
    ]);
    return {
      message: 'Inquiries retrieved successfully',
      data: { items, total, page, limit },
    };
  }

  /**
   * Changes an inquiry's status.
   * @param {string} id Inquiry id.
   * @param {ContactInquiryStatus} status New status.
   * @returns {Promise<object>} Updated inquiry.
   */
  async updateStatus(id: string, status: ContactInquiryStatus) {
    await this.findOrThrow(id);
    const data = await this.prisma.contactInquiry.update({
      where: { id },
      data: {
        status,
        readAt: status === ContactInquiryStatus.NEW ? null : new Date(),
      },
    });
    return { message: 'Inquiry updated successfully', data };
  }

  /**
   * Soft-deletes an inquiry.
   * @param {string} id Inquiry id.
   * @param {CurrentUser} user Acting superadmin.
   * @param {string} [reason] Optional reason.
   * @returns {Promise<object>} Confirmation payload.
   */
  async remove(id: string, user: CurrentUser, reason?: string) {
    await this.findOrThrow(id);
    await this.prisma.contactInquiry.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedBy: user.sub,
        deleteReason: reason ?? null,
        updatedBy: user.sub,
      },
    });
    return { message: 'Inquiry deleted successfully', data: null };
  }

  private async findOrThrow(id: string) {
    const found = await this.prisma.contactInquiry.findFirst({
      where: { id, deletedAt: null },
    });
    if (!found) {
      throw new NotFoundException('Inquiry not found.');
    }
    return found;
  }
}
