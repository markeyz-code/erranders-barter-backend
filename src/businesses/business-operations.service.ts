import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Business } from './schemas/business.schema';
import {
  PageBlockType,
  ApplicationStatus,
  JobType,
  PayoutStatus,
} from './schemas/business.schema';
import { Booking, BookingStatus } from '../bookings/schemas/booking.schema';

/**
 * The operating surface of a business: money, people, branches and automation.
 *
 * Kept separate from BusinessesService (which owns the profile, the public page and the
 * admin relationship) because these are the day-to-day levers an owner pulls, and the two
 * grow at different rates.
 *
 * Money rule that applies to everything here: a figure is only ever derived from bookings
 * that actually completed. Nothing is stored as a balance that could drift from the ledger.
 */

/** A payout below this is not worth the transfer fees. */
const MINIMUM_PAYOUT = 1_000;

export interface LedgerEntry {
  type: 'credit' | 'debit';
  at: string;
  description: string;
  amount: number;
  bookingId?: string;
  payoutId?: string;
  /** Net for a credit, negative for a debit. */
  signed: number;
}

@Injectable()
export class BusinessOperationsService {
  constructor(
    @InjectModel(Business.name) private businessModel: Model<Business>,
    @InjectModel(Booking.name) private bookingModel: Model<Booking>,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async ownedBusiness(userId: string): Promise<any> {
    if (!Types.ObjectId.isValid(userId)) throw new NotFoundException('Business not found');
    const business = await this.businessModel.findOne({ ownerId: userId }).lean().exec();
    if (!business) {
      throw new NotFoundException(
        'You do not have a business account yet. Apply with POST /businesses/apply.',
      );
    }
    return business;
  }

  /** Owner account plus every staff account linked to a platform user. */
  private partyIds(business: any): Types.ObjectId[] {
    const ids = new Map<string, Types.ObjectId>();
    const add = (value: unknown) => {
      if (!value) return;
      const inner =
        value instanceof Types.ObjectId
          ? value
          : typeof value === 'object'
            ? (value as { _id?: unknown })._id
            : value;
      if (inner instanceof Types.ObjectId) ids.set(inner.toString(), inner);
      else if (typeof inner === 'string' && Types.ObjectId.isValid(inner)) {
        ids.set(inner, new Types.ObjectId(inner));
      }
    };
    add(business.ownerId);
    for (const member of business.staff || []) add(member?.userId);
    return [...ids.values()];
  }

  private commissionRate(business: any): number {
    return Math.max(0, Math.min(50, Number(business.commissionRate) || 0));
  }

  /** Completed bookings attributed to the business, newest first. */
  private async completedBookings(business: any): Promise<any[]> {
    const parties = this.partyIds(business);
    if (!parties.length) return [];
    return this.bookingModel
      .find({ providerId: { $in: parties }, status: BookingStatus.COMPLETED })
      .populate('serviceId', 'title')
      .populate('customerId', 'firstName lastName email')
      .sort({ date: -1, startTime: -1 })
      .lean()
      .exec();
  }

  /**
   * The money the business has actually earned and not yet been paid.
   *
   * Credits are completed jobs net of commission; debits are payouts that have not
   * failed. A failed payout returns the money to the balance, which is why it is excluded
   * rather than subtracted.
   */
  private computeBalance(business: any, completed: any[]): {
    gross: number;
    commission: number;
    net: number;
    paidOut: number;
    pendingPayouts: number;
    available: number;
  } {
    const rate = this.commissionRate(business);

    let gross = 0;
    for (const booking of completed) gross += Number(booking.amount) || 0;
    const commission = Math.round((gross * rate) / 100);
    const net = gross - commission;

    let paidOut = 0;
    let pendingPayouts = 0;
    for (const payout of business.payouts || []) {
      const amount = Number(payout.amount) || 0;
      if (payout.status === PayoutStatus.PAID) paidOut += amount;
      else if (payout.status === PayoutStatus.PENDING || payout.status === PayoutStatus.PROCESSING) {
        pendingPayouts += amount;
      }
    }

    return {
      gross,
      commission,
      net,
      paidOut,
      pendingPayouts,
      available: Math.max(0, net - paidOut - pendingPayouts),
    };
  }

  // ── Transactions & payouts ─────────────────────────────────────────────────

  /** The running ledger: every completed job as a credit, every payout as a debit. */
  async getTransactions(userId: string, query: any) {
    const business = await this.ownedBusiness(userId);
    const completed = await this.completedBookings(business);
    const rate = this.commissionRate(business);

    const entries: LedgerEntry[] = completed.map((booking) => {
      const amount = Number(booking.amount) || 0;
      const commission = Math.round((amount * rate) / 100);
      const net = amount - commission;
      return {
        type: 'credit',
        at: booking.date ? `${booking.date}T${booking.startTime || '00:00'}:00` : new Date().toISOString(),
        description: (booking.serviceId as any)?.title || 'Completed job',
        amount: net,
        bookingId: String(booking._id),
        signed: net,
      };
    });

    for (const payout of business.payouts || []) {
      if (payout.status === PayoutStatus.FAILED) continue;
      entries.push({
        type: 'debit',
        at: (payout.requestedAt ? new Date(payout.requestedAt) : new Date()).toISOString(),
        description: `Payout · ${payout.status}`,
        amount: Number(payout.amount) || 0,
        payoutId: String(payout._id),
        signed: -(Number(payout.amount) || 0),
      });
    }

    entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query?.limit) || 50));
    const start = (page - 1) * limit;

    return {
      balance: this.computeBalance(business, completed),
      data: entries.slice(start, start + limit),
      meta: {
        total: entries.length,
        page,
        limit,
        totalPages: Math.ceil(entries.length / limit) || 1,
      },
    };
  }

  async listPayouts(userId: string) {
    const business = await this.ownedBusiness(userId);
    const completed = await this.completedBookings(business);
    const payouts = [...(business.payouts || [])].sort(
      (a: any, b: any) =>
        new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime(),
    );
    return { balance: this.computeBalance(business, completed), data: payouts };
  }

  /**
   * Ask for the available balance to be paid out.
   *
   * Three things are enforced here, because a payout that is allowed to overdraw is worse
   * than one that is refused: the amount must be at least the transfer minimum, it can
   * never exceed what has actually been earned and not already paid or pending, and only
   * one payout may be pending at a time so the balance cannot be double-spent by clicking
   * twice.
   */
  async requestPayout(userId: string, dto: any) {
    const business = await this.ownedBusiness(userId);
    const completed = await this.completedBookings(business);
    const balance = this.computeBalance(business, completed);

    const amount = Number(dto?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('amount must be a positive number');
    }
    if (amount < MINIMUM_PAYOUT) {
      throw new BadRequestException(
        `The minimum payout is ₦${MINIMUM_PAYOUT.toLocaleString('en-NG')}.`,
      );
    }
    if (amount > balance.available) {
      throw new BadRequestException(
        `You can request at most ₦${balance.available.toLocaleString('en-NG')} right now.`,
      );
    }

    const pending = (business.payouts || []).some(
      (payout: any) =>
        payout.status === PayoutStatus.PENDING || payout.status === PayoutStatus.PROCESSING,
    );
    if (pending) {
      throw new BadRequestException(
        'You already have a payout in progress. Wait for it to finish before requesting another.',
      );
    }

    // Atomic guard: match the current payout array so a concurrent request cannot also
    // append. `$size` alone does NOT match a document whose field is missing (businesses
    // created before payouts existed), which made the first request fail — hence $ifNull.
    const expectedSize = (business.payouts || []).length;
    const updated = await this.businessModel
      .findOneAndUpdate(
        {
          _id: business._id,
          $expr: { $eq: [{ $size: { $ifNull: ['$payouts', []] } }, expectedSize] },
        },
        {
          $push: {
            payouts: {
              amount,
              status: PayoutStatus.PENDING,
              requestedAt: new Date(),
            },
          },
        },
        { new: true },
      )
      .lean()
      .exec();

    if (!updated) {
      throw new BadRequestException('A payout request was made at the same time. Please refresh.');
    }

    const created = (updated.payouts || [])[(updated.payouts || []).length - 1];
    return { payout: created, balance: this.computeBalance(updated, completed) };
  }


  // ── Public page builder ────────────────────────────────────────────────────

  /** The owner's current page design (empty blocks = the default layout). */
  async getPage(userId: string) {
    const business: any = await this.ownedBusiness(userId);
    return {
      page: business.page || { blocks: [], accentColor: '' },
      /** The types the builder may use — the UI never hardcodes this list. */
      blockTypes: Object.values(PageBlockType),
    };
  }

  /**
   * Replace the page design.
   *
   * Validated hard, because this document is rendered on a public page: the type must be
   * one the renderer knows, ids must be unique, block count and payload size are capped,
   * and unknown prop keys are dropped rather than stored.
   */
  async updatePage(userId: string, dto: any) {
    const business = await this.ownedBusiness(userId);

    const rawBlocks = Array.isArray(dto?.blocks) ? dto.blocks : null;
    if (!rawBlocks) throw new BadRequestException('blocks must be an array');
    if (rawBlocks.length > 20) {
      throw new BadRequestException('A page can have at most 20 sections.');
    }

    const allowed = new Set(Object.values(PageBlockType));
    const seenIds = new Set<string>();
    const blocks = rawBlocks.map((block: any, index: number) => {
      const type = String(block?.type || '');
      if (!allowed.has(type as PageBlockType)) {
        throw new BadRequestException(
          `Section ${index + 1} has an unknown type "${type}". Allowed: ${[...allowed].join(', ')}`,
        );
      }

      const id = String(block?.id || '').trim() || `${type}-${index}`;
      if (seenIds.has(id)) throw new BadRequestException(`Duplicate section id "${id}".`);
      seenIds.add(id);

      // Props are free-form per type, but must stay a plain object of bounded size.
      const props =
        block?.props && typeof block.props === 'object' && !Array.isArray(block.props)
          ? block.props
          : {};
      if (JSON.stringify(props).length > 20_000) {
        throw new BadRequestException(`Section ${index + 1} is too large.`);
      }

      return {
        id,
        type,
        isVisible: block?.isVisible !== false,
        props,
      };
    });

    const accentColor = String(dto?.accentColor || '').trim();
    if (accentColor && !/^#[0-9a-fA-F]{6}$/.test(accentColor)) {
      throw new BadRequestException('accentColor must be a hex colour like #FF5C1A.');
    }

    const updated = await this.businessModel
      .findByIdAndUpdate(
        business._id,
        { $set: { page: { blocks, accentColor, updatedAt: new Date() } } },
        { new: true },
      )
      .lean()
      .exec();

    return { page: (updated as any)?.page || { blocks, accentColor } };
  }

  // ── Automation ─────────────────────────────────────────────────────────────

  async getAutomation(userId: string) {
    const business = await this.ownedBusiness(userId);
    return {
      automation: business.automation || {
        autoAccept: false,
        autoAssign: false,
        leadTimeMinutes: 120,
        maxDailyJobs: 0,
        bufferMinutes: 0,
      },
    };
  }

  async updateAutomation(userId: string, dto: any) {
    const business = await this.ownedBusiness(userId);
    const current = business.automation || {};

    const next: Record<string, unknown> = {};
    if (typeof dto?.autoAccept === 'boolean') next['automation.autoAccept'] = dto.autoAccept;
    if (typeof dto?.autoAssign === 'boolean') next['automation.autoAssign'] = dto.autoAssign;

    for (const [field, max] of [
      ['leadTimeMinutes', 60 * 24 * 30],
      ['maxDailyJobs', 1000],
      ['bufferMinutes', 240],
    ] as const) {
      if (dto?.[field] === undefined) continue;
      const value = Number(dto[field]);
      if (!Number.isFinite(value) || value < 0 || value > max) {
        throw new BadRequestException(`${field} must be between 0 and ${max}`);
      }
      next[`automation.${field}`] = Math.round(value);
    }

    if (!Object.keys(next).length) {
      throw new BadRequestException(
        'No updatable fields provided. Allowed: autoAccept, autoAssign, leadTimeMinutes, maxDailyJobs, bufferMinutes.',
      );
    }

    const updated = await this.businessModel
      .findByIdAndUpdate(business._id, { $set: next }, { new: true })
      .lean()
      .exec();

    return { automation: (updated as any)?.automation || current };
  }

  // ── Locations (scaling) ────────────────────────────────────────────────────

  async listLocations(userId: string) {
    const business = await this.ownedBusiness(userId);
    return business.locations || [];
  }

  async addLocation(userId: string, dto: any) {
    const business = await this.ownedBusiness(userId);
    const name = String(dto?.name || '').trim();
    if (name.length < 2) throw new BadRequestException('A location needs a name.');

    const updated = await this.businessModel
      .findByIdAndUpdate(
        business._id,
        {
          $push: {
            locations: {
              name,
              address: String(dto?.address || '').trim(),
              phone: String(dto?.phone || '').trim(),
              isActive: true,
            },
          },
        },
        { new: true },
      )
      .lean()
      .exec();
    const list = (updated as any)?.locations || [];
    return list[list.length - 1];
  }

  async updateLocation(userId: string, locationId: string, dto: any) {
    if (!Types.ObjectId.isValid(locationId)) throw new NotFoundException('Location not found');
    const business = await this.ownedBusiness(userId);

    const location = (business.locations || []).find(
      (l: any) => String(l._id) === locationId,
    );
    if (!location) throw new NotFoundException('Location not found');

    const set: Record<string, unknown> = {};
    if (typeof dto?.name === 'string') set['locations.$.name'] = dto.name.trim();
    if (typeof dto?.address === 'string') set['locations.$.address'] = dto.address.trim();
    if (typeof dto?.phone === 'string') set['locations.$.phone'] = dto.phone.trim();
    if (typeof dto?.isActive === 'boolean') set['locations.$.isActive'] = dto.isActive;

    if (!Object.keys(set).length) throw new BadRequestException('No updatable fields provided.');

    const updated = await this.businessModel
      .findOneAndUpdate(
        { _id: business._id, 'locations._id': new Types.ObjectId(locationId) },
        { $set: set },
        { new: true },
      )
      .lean()
      .exec();

    return (updated as any)?.locations?.find((l: any) => String(l._id) === locationId);
  }

  async removeLocation(userId: string, locationId: string) {
    if (!Types.ObjectId.isValid(locationId)) throw new NotFoundException('Location not found');
    const business = await this.ownedBusiness(userId);

    await this.businessModel
      .updateOne(
        { _id: business._id },
        { $pull: { locations: { _id: new Types.ObjectId(locationId) } } },
      )
      .exec();

    return { success: true, deleted: true, locationId };
  }

  // ── Recruitment pipeline ───────────────────────────────────────────────────

  /**
   * Public: someone applies to an opening on a business's page.
   *
   * Deliberately unauthenticated — a candidate should not have to create a marketplace
   * account to apply for a job — and deliberately narrow: it can only append an
   * application, never read or change anything.
   */
  async applyToOpening(slug: string, openingId: string, dto: any) {
    const cleanSlug = String(slug || '').trim().toLowerCase();
    if (!cleanSlug) throw new NotFoundException('Business not found');

    const business = await this.businessModel.findOne({ slug: cleanSlug }).lean().exec();
    if (!business) throw new NotFoundException('Business not found');
    if (business.isActive === false) {
      throw new ForbiddenException('This business is not accepting applications right now.');
    }

    const name = String(dto?.name || '').trim();
    const email = String(dto?.email || '').trim().toLowerCase();
    if (name.length < 2) throw new BadRequestException('Please provide your name.');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new BadRequestException('Please provide a valid email.');

    const opening = (business.openings || []).find(
      (o: any) => String(o._id) === String(openingId),
    );
    if (!opening) throw new NotFoundException('That role no longer exists.');
    if (opening.isOpen === false) {
      throw new BadRequestException('That role is no longer open.');
    }

    // One application per person per role — a refresh must not create duplicates.
    const duplicate = (business.applications || []).some(
      (a: any) => a.email === email && String(a.openingId) === String(openingId),
    );
    if (duplicate) {
      throw new BadRequestException('You have already applied for this role.');
    }

    await this.businessModel
      .updateOne(
        { _id: business._id },
        {
          $push: {
            applications: {
              openingId: opening._id,
              openingTitle: opening.title,
              name,
              email,
              phone: String(dto?.phone || '').trim(),
              message: String(dto?.message || '').trim().slice(0, 2000),
              status: ApplicationStatus.NEW,
              createdAt: new Date(),
            },
          },
        },
      )
      .exec();

    return { success: true, received: true };
  }

  async listApplications(userId: string, query: any) {
    const business = await this.ownedBusiness(userId);
    let rows = [...(business.applications || [])];
    if (query?.status) rows = rows.filter((a: any) => a.status === query.status);
    rows.sort(
      (a: any, b: any) =>
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
    );
    return rows;
  }

  /**
   * Move a candidate through the pipeline. Hiring also creates the crew member, because
   * making the owner re-type the person they just hired is exactly the kind of double entry
   * that loses data.
   */
  async updateApplication(userId: string, applicationId: string, dto: any) {
    if (!Types.ObjectId.isValid(applicationId)) throw new NotFoundException('Application not found');
    const business = await this.ownedBusiness(userId);

    const application = (business.applications || []).find(
      (a: any) => String(a._id) === applicationId,
    );
    if (!application) throw new NotFoundException('Application not found');

    const status = dto?.status as ApplicationStatus | undefined;
    if (status && !Object.values(ApplicationStatus).includes(status)) {
      throw new BadRequestException(
        `status must be one of: ${Object.values(ApplicationStatus).join(', ')}`,
      );
    }

    const set: Record<string, unknown> = {};
    if (status) set['applications.$.status'] = status;
    if (typeof dto?.note === 'string') set['applications.$.note'] = dto.note.trim();
    if (!Object.keys(set).length) throw new BadRequestException('No updatable fields provided.');

    const updated = await this.businessModel
      .findOneAndUpdate(
        { _id: business._id, 'applications._id': new Types.ObjectId(applicationId) },
        { $set: set },
        { new: true },
      )
      .lean()
      .exec();

    const result = (updated as any)?.applications?.find(
      (a: any) => String(a._id) === applicationId,
    );

    // Hiring is idempotent: the crew row is only created once, even if the owner clicks twice.
    let hired: any = null;
    if (status === ApplicationStatus.HIRED) {
      const already = ((updated as any)?.staff || []).some(
        (s: any) => String(s.phone || '').trim() === String(application.phone || '').trim() &&
          String(s.name).toLowerCase() === String(application.name).toLowerCase() &&
          application.phone,
      );
      if (!already) {
        const withStaff = await this.businessModel
          .findByIdAndUpdate(
            business._id,
            {
              $push: {
                staff: {
                  name: application.name,
                  role: application.openingTitle || 'Team member',
                  phone: application.phone || '',
                  isActive: true,
                },
              },
            },
            { new: true },
          )
          .lean()
          .exec();
        const staffList = (withStaff as any)?.staff || [];
        hired = staffList[staffList.length - 1];
      }
    }

    return { application: result, hiredStaff: hired };
  }

  // ── Assigning work ─────────────────────────────────────────────────────────

  /**
   * Attach a crew member to a booking.
   *
   * Restricted to a person who actually works for this business — otherwise an owner could
   * hand a job to any account on the platform, and the earnings attribution would follow it.
   */
  async assignCrew(userId: string, bookingId: string, dto: any) {
    if (!Types.ObjectId.isValid(bookingId)) throw new NotFoundException('Booking not found');
    const business = await this.ownedBusiness(userId);

    const staffId = String(dto?.staffId || '');
    const staff = (business.staff || []).find((s: any) => String(s._id) === staffId);
    if (!staff) throw new NotFoundException('That crew member is not part of this business.');
    if (staff.isActive === false) {
      throw new BadRequestException('That crew member is paused.');
    }

    const booking: any = await this.bookingModel.findById(bookingId).lean().exec();
    if (!booking) throw new NotFoundException('Booking not found');

    const parties = this.partyIds(business).map(String);
    if (!parties.includes(String(booking.providerId))) {
      throw new ForbiddenException('That booking does not belong to this business.');
    }

    // A crew member without a platform account cannot be the booking's provider, because
    // attribution and notifications both key off that id.
    if (!staff.userId) {
      throw new BadRequestException(
        `${staff.name} does not have a linked platform account yet, so a job cannot be assigned to them. Link their account first.`,
      );
    }

    const updated = await this.bookingModel
      .findByIdAndUpdate(bookingId, { $set: { providerId: staff.userId } }, { new: true })
      .lean()
      .exec();

    return { booking: updated, assignedTo: { _id: staff._id, name: staff.name } };
  }

  // ── Insight ────────────────────────────────────────────────────────────────

  /** Revenue and volume over time, plus what is selling and who keeps coming back. */
  async getAnalytics(userId: string, query: any) {
    const business = await this.ownedBusiness(userId);
    const days = Math.min(365, Math.max(7, Number(query?.days) || 30));
    const rate = this.commissionRate(business);

    const parties = this.partyIds(business);
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceIso = since.toISOString().slice(0, 10);

    const bookings: any[] = parties.length
      ? await this.bookingModel
          .find({
            providerId: { $in: parties },
            date: { $gte: sinceIso },
          })
          .populate('serviceId', 'title')
          .lean()
          .exec()
      : [];

    const byDay = new Map<string, { revenue: number; jobs: number }>();
    for (let i = 0; i < days; i += 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      byDay.set(d.toISOString().slice(0, 10), { revenue: 0, jobs: 0 });
    }

    const byStatus: Record<string, number> = {};
    const byService = new Map<string, { title: string; jobs: number; revenue: number }>();
    let revenue = 0;
    let completed = 0;

    for (const booking of bookings) {
      byStatus[booking.status] = (byStatus[booking.status] || 0) + 1;
      const day = byDay.get(booking.date);
      const amount = Number(booking.amount) || 0;

      if (booking.status === BookingStatus.COMPLETED) {
        completed += 1;
        revenue += amount;
        if (day) {
          day.revenue += amount;
          day.jobs += 1;
        }
        const title = (booking.serviceId as any)?.title || 'Service';
        const entry = byService.get(title) || { title, jobs: 0, revenue: 0 };
        entry.jobs += 1;
        entry.revenue += amount;
        byService.set(title, entry);
      } else if (day) {
        day.jobs += 1;
      }
    }

    const series = [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, value]) => ({ date, ...value }));

    const totalJobs = bookings.length;
    const completionRate = totalJobs ? Math.round((completed / totalJobs) * 100) : 0;

    return {
      range: { days, since: sinceIso },
      totals: {
        revenue,
        commission: Math.round((revenue * rate) / 100),
        net: revenue - Math.round((revenue * rate) / 100),
        jobs: totalJobs,
        completed,
        completionRate,
        averageJobValue: completed ? Math.round(revenue / completed) : 0,
      },
      series,
      byStatus,
      topServices: [...byService.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5),
    };
  }

  /** Repeat customers, most valuable first. */
  async listCustomers(userId: string) {
    const business = await this.ownedBusiness(userId);
    const parties = this.partyIds(business);
    if (!parties.length) return [];

    const rows: any[] = await this.bookingModel
      .find({ providerId: { $in: parties } })
      .populate('customerId', 'firstName lastName email phone')
      .lean()
      .exec();

    const map = new Map<
      string,
      { customerId: string; name: string; email?: string; phone?: string; jobs: number; spend: number; lastJob?: string }
    >();

    for (const booking of rows) {
      const customer = booking.customerId;
      if (!customer || typeof customer !== 'object') continue;
      const id = String(customer._id);
      const entry =
        map.get(id) || {
          customerId: id,
          name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Customer',
          email: customer.email,
          phone: customer.phone,
          jobs: 0,
          spend: 0,
          lastJob: undefined,
        };
      entry.jobs += 1;
      if (booking.status === BookingStatus.COMPLETED) {
        entry.spend += Number(booking.amount) || 0;
      }
      if (!entry.lastJob || (booking.date && booking.date > entry.lastJob)) {
        entry.lastJob = booking.date;
      }
      map.set(id, entry);
    }

    return [...map.values()].sort((a, b) => b.spend - a.spend || b.jobs - a.jobs);
  }
}
