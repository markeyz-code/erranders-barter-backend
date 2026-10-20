import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Report,
  ReportReason,
  ReportStatus,
  ReportTargetType,
} from './schemas/report.schema';
import { SupportTicket, TicketStatus } from './schemas/support-ticket.schema';
import { EmailService } from '../notifications/email.service';

/**
 * Safety and support.
 *
 * Two things every marketplace needs and this one lacked: a way to report a listing or a
 * person, and a support message that is actually stored rather than a toast that lies.
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @InjectModel(Report.name) private reportModel: Model<Report>,
    @InjectModel(SupportTicket.name) private ticketModel: Model<SupportTicket>,
    private readonly emailService: EmailService,
  ) {}

  /**
   * File a report.
   *
   * One report per person per target: a second attempt updates the first rather than
   * stacking duplicates in the queue, which keeps triage honest.
   */
  async createReport(userId: string, dto: any) {
    const targetType = String(dto?.targetType || '');
    if (!Object.values(ReportTargetType).includes(targetType as ReportTargetType)) {
      throw new BadRequestException(
        `targetType must be one of: ${Object.values(ReportTargetType).join(', ')}`,
      );
    }

    const reason = String(dto?.reason || '');
    if (!Object.values(ReportReason).includes(reason as ReportReason)) {
      throw new BadRequestException(
        `reason must be one of: ${Object.values(ReportReason).join(', ')}`,
      );
    }

    const targetId = String(dto?.targetId || '');
    if (!Types.ObjectId.isValid(targetId)) throw new BadRequestException('A valid targetId is required.');

    const details = String(dto?.details || '').trim();
    if (details.length < 10) {
      throw new BadRequestException('Please describe what happened in at least a sentence.');
    }

    const existing = await this.reportModel
      .findOne({ reporterId: userId, targetType, targetId })
      .exec();

    if (existing) {
      existing.reason = reason as ReportReason;
      existing.details = details;
      existing.status = ReportStatus.OPEN;
      await existing.save();
      return { report: existing, updated: true };
    }

    const report = await this.reportModel.create({
      reporterId: userId,
      targetType,
      targetId,
      targetLabel: String(dto?.targetLabel || '').slice(0, 200),
      reason,
      details,
      status: ReportStatus.OPEN,
    });

    // Support must hear about a scam claim immediately; everything else can queue.
    if (reason === ReportReason.SCAM || reason === ReportReason.COUNTERFEIT) {
      this.emailService
        .sendEmail(
          process.env.SUPPORT_EMAIL || 'support@decluttered.erranders.org',
          `Urgent report: ${reason} on ${targetType}`,
          `<p>A ${reason} report was filed against ${targetType} ${targetId}.</p><p>${details}</p>`,
        )
        .catch((error) => this.logger.warn(`Could not notify support: ${error?.message}`));
    }

    return { report, updated: false };
  }

  async myReports(userId: string) {
    return this.reportModel
      .find({ reporterId: userId })
      .sort({ createdAt: -1 })
      .select('targetType targetId targetLabel reason status createdAt')
      .lean()
      .exec();
  }

  /**
   * Contact support.
   *
   * Stores the message and returns a real reference. An unauthenticated visitor may still
   * write in — requiring an account to report a problem would be a good way to never hear
   * about problems.
   */
  async createTicket(userId: string | null, dto: any) {
    const email = String(dto?.email || '').trim().toLowerCase();
    const name = String(dto?.name || '').trim();
    const subject = String(dto?.subject || '').trim();
    const message = String(dto?.message || '').trim();

    if (!/^\S+@\S+\.\S+$/.test(email)) throw new BadRequestException('Please provide a valid email.');
    if (name.length < 2) throw new BadRequestException('Please provide your name.');
    if (subject.length < 3) throw new BadRequestException('Please add a short subject.');
    if (message.length < 10) throw new BadRequestException('Please describe the issue.');

    const reference = `DC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const ticket = await this.ticketModel.create({
      userId: userId && Types.ObjectId.isValid(userId) ? userId : undefined,
      email,
      name,
      subject,
      message,
      status: TicketStatus.OPEN,
      reference,
    });

    // Delivery is best-effort: the ticket already exists, so a mail failure cannot lose it.
    this.emailService
      .sendEmail(
        process.env.SUPPORT_EMAIL || 'support@decluttered.erranders.org',
        `Support: ${subject} (${reference})`,
        `<p><strong>${name}</strong> &lt;${email}&gt;</p><p>${message}</p>`,
      )
      .catch((error) => this.logger.warn(`Could not email support: ${error?.message}`));

    return { reference, status: ticket.status };
  }

  // ── Admin: work the queue ──────────────────────────────────────────────────

  /** The moderation queue, newest first, with the reporter attached for context. */
  async listReports(query: any) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query?.limit) || 50));

    const filter: Record<string, unknown> = {};
    if (query?.status) filter.status = String(query.status);
    if (query?.reason) filter.reason = String(query.reason);
    if (query?.targetType) filter.targetType = String(query.targetType);

    const [rows, total] = await Promise.all([
      this.reportModel
        .find(filter)
        .populate('reporterId', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.reportModel.countDocuments(filter).exec(),
    ]);

    return {
      data: rows,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async resolveReport(reportId: string, dto: any) {
    if (!Types.ObjectId.isValid(reportId)) throw new BadRequestException('Report not found');

    const status = String(dto?.status || '');
    if (!Object.values(ReportStatus).includes(status as ReportStatus)) {
      throw new BadRequestException(
        `status must be one of: ${Object.values(ReportStatus).join(', ')}`,
      );
    }

    const updated = await this.reportModel
      .findByIdAndUpdate(
        reportId,
        { $set: { status, adminNote: String(dto?.adminNote || '').slice(0, 1000) } },
        { new: true },
      )
      .lean()
      .exec();

    if (!updated) throw new BadRequestException('Report not found');
    return updated;
  }

  async listTickets(query: any) {
    const filter: Record<string, unknown> = {};
    if (query?.status) filter.status = String(query.status);

    return this.ticketModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(200, Number(query?.limit) || 100))
      .lean()
      .exec();
  }

  async updateTicket(ticketId: string, dto: any) {
    if (!Types.ObjectId.isValid(ticketId)) throw new BadRequestException('Ticket not found');

    const set: Record<string, unknown> = {};
    if (typeof dto?.reply === 'string') set.reply = dto.reply.slice(0, 4000);
    if (typeof dto?.status === 'string') {
      if (!Object.values(TicketStatus).includes(dto.status as TicketStatus)) {
        throw new BadRequestException('Invalid ticket status.');
      }
      set.status = dto.status;
    }
    if (!Object.keys(set).length) throw new BadRequestException('No updatable fields provided.');

    const updated = await this.ticketModel.findByIdAndUpdate(ticketId, { $set: set }, { new: true }).lean().exec();
    if (!updated) throw new BadRequestException('Ticket not found');

    // A reply is only useful if it reaches the person who asked.
    if (set.reply) {
      this.emailService
        .sendEmail((updated as any).email, `Re: ${(updated as any).subject}`, `<p>${set.reply}</p>`)
        .catch((error) => this.logger.warn(`Could not email the ticket reply: ${error?.message}`));
    }

    return updated;
  }

}
