import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Business,
  BusinessStaff,
  JobOpening,
  JobType,
} from './schemas/business.schema';
import { Booking, BookingStatus } from '../bookings/schemas/booking.schema';
import { SettingsService } from '../settings/settings.service';
import { ApplyBusinessDto } from './dto/apply-business.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { CreateOpeningDto } from './dto/create-opening.dto';
import { UpdateOpeningDto } from './dto/update-opening.dto';
import { AdminUpdateBusinessDto } from './dto/admin-update-business.dto';

/**
 * Owner-settable profile fields, and the complete list: anything not named here cannot be
 * written by the owner. `commissionRate` and `isVerified` are intentionally absent — they
 * are the two fields the admin surface owns, and leaving them out of this array (rather than
 * filtering a spread of the body) is what keeps a crafted PATCH from escalating.
 */
const OWNER_UPDATABLE_FIELDS = [
  'name',
  'description',
  'logo',
  'banner',
  'phone',
  'email',
  'address',
  'isActive',
];

// Public business page: no commission rate and no staff details. `ownerId` and the staff
// account ids are selected only so the job count can be computed live, then stripped below.
const PUBLIC_BUSINESS_FIELDS =
  'name slug category description logo banner phone email address isVerified rating createdAt isActive openings ownerId staff.userId';

// A business owner sees their own history; a very old business must not get an unbounded
// response. Totals are still computed over every attributed booking.
const PAYOUT_HISTORY_LIMIT = 100;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MIN_LENGTH = 3;
const SLUG_MAX_LENGTH = 40;

// Hostnames the website and infrastructure already answer on. Letting a business claim one
// would shadow the platform itself once wildcard subdomains are wired up.
const RESERVED_SLUGS = new Set([
  'www',
  'api',
  'app',
  'admin',
  'dashboard',
  'businesses',
  'business',
  'become-a-business',
  'me',
  'mail',
  'support',
  'help',
  'account',
  'login',
  'signup',
  'static',
  'assets',
  'cdn',
  'docs',
  'status',
  'blog',
]);

const OWNER_POPULATE = 'firstName lastName email isActive';

// Admin-controlled platform default for a business that has not been reviewed yet. Missing
// or malformed means no commission is charged, never a made-up number.
const DEFAULT_COMMISSION_SETTING = 'service_business_commission_percentage';

@Injectable()
export class BusinessesService {
  constructor(
    @InjectModel(Business.name) private businessModel: Model<Business>,
    @InjectModel(Booking.name) private bookingModel: Model<Booking>,
    private readonly settingsService: SettingsService,
  ) {}

  // ---------------------------------------------------------------------------------------
  // Application & profile
  // ---------------------------------------------------------------------------------------

  /**
   * Applies as a business owned by the caller. One business per account: a second apply is a
   * 409 telling the owner to use PATCH /businesses/me. A new business starts unverified; its
   * commission comes from the admin-controlled platform default and can then be overridden
   * per business through PATCH /admin/businesses/:id. When that setting is absent the rate is
   * 0 — the platform never invents a charge.
   */
  async apply(userId: string, dto: ApplyBusinessDto): Promise<Business> {
    const existing = await this.businessModel.exists({ ownerId: userId });
    if (existing) {
      throw new ConflictException(
        'You already manage a business. Use PATCH /businesses/me to update it.',
      );
    }

    const slug = this.normaliseSlug(dto?.slug);
    const name = this.requireText(dto?.name, 'name', 120);
    const category = this.requireText(dto?.category, 'category', 60);
    const description = this.requireText(dto?.description, 'description', 4000);

    // Fast, explicit answer for the common case; the unique index below still handles the
    // race where two applicants submit the same slug at once.
    if (await this.businessModel.exists({ slug })) {
      throw new ConflictException(`The slug "${slug}" is already taken. Choose another one.`);
    }

    try {
      return await this.businessModel.create({
        ownerId: userId,
        name,
        slug,
        category: category.toLowerCase(),
        description,
        logo: '',
        banner: '',
        phone: this.cleanText(dto?.phone),
        email: this.cleanText(dto?.email).toLowerCase(),
        address: this.cleanText(dto?.address),
        isActive: true,
        isVerified: false,
        commissionRate: await this.defaultCommissionRate(),
        staff: [],
        openings: [],
        rating: 0,
        totalJobs: 0,
      });
    } catch (error) {
      // The pre-check above cannot win a race with a simultaneous apply; the unique index can.
      if (this.isDuplicateKey(error)) {
        const taken = await this.businessModel.exists({ slug });
        if (taken) {
          throw new ConflictException(
            `The slug "${slug}" is already taken. Choose another one.`,
          );
        }
        throw new ConflictException(
          'You already manage a business. Use PATCH /businesses/me to update it.',
        );
      }
      throw error;
    }
  }

  /** The caller's business, staff and openings included. */
  async getMine(userId: string): Promise<Business> {
    return this.getOwnedBusiness(userId);
  }

  /** Owner-only profile update. Admin money/trust fields are not accepted. */
  async updateMine(userId: string, dto: UpdateBusinessDto): Promise<Business> {
    const business = await this.getOwnedBusiness(userId);

    const update: any = {};
    for (const field of OWNER_UPDATABLE_FIELDS) {
      if (dto && (dto as any)[field] !== undefined) update[field] = (dto as any)[field];
    }
    if (Object.keys(update).length === 0) {
      throw new BadRequestException(
        `No updatable fields provided. Allowed: ${OWNER_UPDATABLE_FIELDS.join(', ')}`,
      );
    }

    if (update.name !== undefined) {
      update.name = this.requireText(update.name, 'name', 120);
    }
    for (const field of ['description', 'logo', 'banner', 'phone', 'email', 'address']) {
      if (update[field] !== undefined) update[field] = this.cleanText(update[field]);
    }
    if (update.email) update.email = String(update.email).toLowerCase();
    if (update.isActive !== undefined) {
      update.isActive = this.parseBoolean(update.isActive, 'isActive');
    }

    return this.businessModel
      .findByIdAndUpdate(business._id, { $set: update }, { new: true })
      .exec();
  }

  /**
   * Public business page. Only open roles are returned, staff are never exposed (their phone
   * numbers are personal data) and a paused business is not published at all.
   */
  /**
   * Public directory of active businesses, optionally narrowed by category or a
   * search term.
   *
   * This is what lets a category storefront (fumigation, laundry, movers) be a real
   * view of the database instead of a hand-written page. Only published fields are
   * selected — never staff, commission or the owner account.
   */
  async listPublic(query: any) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(60, Math.max(1, Number(query?.limit) || 24));

    const filter: Record<string, unknown> = { isActive: true };
    if (query?.category) {
      filter.category = new RegExp(`^${String(query.category).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    }
    if (query?.search) {
      const term = String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: new RegExp(term, 'i') },
        { description: new RegExp(term, 'i') },
        { category: new RegExp(term, 'i') },
      ];
    }

    const [rows, total] = await Promise.all([
      this.businessModel
        .find(filter)
        .select(PUBLIC_BUSINESS_FIELDS)
        .sort({ isVerified: -1, rating: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.businessModel.countDocuments(filter).exec(),
    ]);

    // `PUBLIC_BUSINESS_FIELDS` is wide because the detail path needs ownerId and staff
    // to compute live job counts. A LIST must not ship those to the browser, so strip
    // them here exactly as `getPublicBySlug` does.
    const data = rows.map((row: any) => {
      const { ownerId, staff, openings, isActive, ...profile } = row;
      return profile;
    });

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async getPublicBySlug(slug: string) {
    const cleanSlug = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
    if (!cleanSlug) throw new NotFoundException('Business not found');

    const business = await this.businessModel
      .findOne({ slug: cleanSlug })
      .select(PUBLIC_BUSINESS_FIELDS)
      .lean()
      .exec();
    if (!business) throw new NotFoundException('Business not found');
    if (business.isActive === false) {
      throw new NotFoundException('This business is paused and is not available right now');
    }

    const { openings, isActive, ownerId, staff, ...profile } = business as any;
    const openRoles = (openings || []).filter((opening: any) => opening.isOpen !== false);

    // The stored `totalJobs` counter is only a cache; the public page reports the count
    // computed from the same attribution the earnings ledger uses, so the two never disagree.
    const partyIds = [ownerId, ...(staff || []).map((member: any) => member.userId)].filter(
      Boolean,
    );
    const totalJobs = partyIds.length
      ? await this.bookingModel.countDocuments({
          providerId: { $in: partyIds },
          status: { $nin: [BookingStatus.CANCELLED, BookingStatus.DECLINED] },
        })
      : 0;

    return { business: { ...profile, totalJobs }, openings: openRoles };
  }

  // ---------------------------------------------------------------------------------------
  // Staff
  // ---------------------------------------------------------------------------------------

  async listStaff(userId: string): Promise<BusinessStaff[]> {
    const business = await this.getOwnedBusiness(userId);
    return business.staff || [];
  }

  async addStaff(userId: string, dto: CreateStaffDto): Promise<BusinessStaff> {
    const business = await this.getOwnedBusiness(userId);

    const member = {
      name: this.requireText(dto?.name, 'name', 80),
      role: this.requireText(dto?.role, 'role', 80),
      phone: this.cleanText(dto?.phone),
      isActive: true,
    };
    business.staff.push(member as BusinessStaff);
    await business.save();

    // The saved subdocument carries the generated _id the caller needs for later updates.
    return business.staff[business.staff.length - 1];
  }

  async updateStaff(
    userId: string,
    staffId: string,
    dto: UpdateStaffDto,
  ): Promise<BusinessStaff> {
    const business = await this.getOwnedBusiness(userId);
    const member = await this.findStaff(business, staffId);

    let changed = false;
    if (dto?.role !== undefined) {
      member.role = this.requireText(dto.role, 'role', 80);
      changed = true;
    }
    if (dto?.phone !== undefined) {
      member.phone = this.cleanText(dto.phone);
      changed = true;
    }
    if (dto?.isActive !== undefined) {
      member.isActive = this.parseBoolean(dto.isActive, 'isActive');
      changed = true;
    }
    if (!changed) {
      throw new BadRequestException('No updatable fields provided. Allowed: role, phone, isActive');
    }

    await business.save();
    return member;
  }

  async removeStaff(userId: string, staffId: string) {
    const business = await this.getOwnedBusiness(userId);
    const member = await this.findStaff(business, staffId);

    business.staff = business.staff.filter(
      (entry: any) => entry._id.toString() !== member._id.toString(),
    );
    await business.save();

    return { success: true, deleted: true, staffId };
  }

  // ---------------------------------------------------------------------------------------
  // Recruitment openings
  // ---------------------------------------------------------------------------------------

  async listOpenings(userId: string): Promise<JobOpening[]> {
    const business = await this.getOwnedBusiness(userId);
    return business.openings || [];
  }

  async addOpening(userId: string, dto: CreateOpeningDto): Promise<JobOpening> {
    const business = await this.getOwnedBusiness(userId);

    const opening = {
      title: this.requireText(dto?.title, 'title', 120),
      description: this.requireText(dto?.description, 'description', 4000),
      type: this.parseJobType(dto?.type),
      pay: this.parseOptionalAmount(dto?.pay, 'pay'),
      isOpen: true,
    };
    business.openings.push(opening as JobOpening);
    await business.save();

    return business.openings[business.openings.length - 1];
  }

  async updateOpening(
    userId: string,
    openingId: string,
    dto: UpdateOpeningDto,
  ): Promise<JobOpening> {
    const business = await this.getOwnedBusiness(userId);
    const opening = await this.findOpening(business, openingId);

    // Written with a positional update rather than by mutating the subdocument: assigning
    // `undefined` to a Mongoose path is a no-op, so a null `pay` ("no advertised amount")
    // has to be an explicit $unset to actually clear the stored value.
    const set: any = {};
    const unset: any = {};

    if (dto?.isOpen !== undefined) {
      set['openings.$.isOpen'] = this.parseBoolean(dto.isOpen, 'isOpen');
    }
    if (dto?.title !== undefined) {
      set['openings.$.title'] = this.requireText(dto.title, 'title', 120);
    }
    if (dto?.description !== undefined) {
      set['openings.$.description'] = this.requireText(dto.description, 'description', 4000);
    }
    if (dto?.pay !== undefined) {
      if (dto.pay === null) unset['openings.$.pay'] = 1;
      else set['openings.$.pay'] = this.parseOptionalAmount(dto.pay, 'pay');
    }

    if (!Object.keys(set).length && !Object.keys(unset).length) {
      throw new BadRequestException(
        'No updatable fields provided. Allowed: isOpen, title, description, pay',
      );
    }

    const updated = await this.businessModel
      .findOneAndUpdate(
        { _id: business._id, 'openings._id': opening._id },
        {
          ...(Object.keys(set).length ? { $set: set } : {}),
          ...(Object.keys(unset).length ? { $unset: unset } : {}),
        },
        { new: true },
      )
      .exec();
    if (!updated) throw new NotFoundException('Opening not found');

    return (updated.openings as any[]).find(
      (entry) => entry._id.toString() === opening._id.toString(),
    );
  }

  async removeOpening(userId: string, openingId: string) {
    const business = await this.getOwnedBusiness(userId);
    const opening = await this.findOpening(business, openingId);

    business.openings = business.openings.filter(
      (entry: any) => entry._id.toString() !== opening._id.toString(),
    );
    await business.save();

    return { success: true, deleted: true, openingId };
  }

  // ---------------------------------------------------------------------------------------
  // Earnings ledger
  // ---------------------------------------------------------------------------------------

  /**
   * A real ledger, computed on every request from the bookings the business is attributable
   * to. Nothing is stored or simulated.
   *
   * Attribution: `Service.providerId` and `Booking.providerId` reference a *user*, and no
   * record links a booking to a business directly. The only honest join is the business
   * document itself — the owner account plus every staff member whose platform account is
   * linked (`staff.userId`). So the ledger counts bookings where `providerId` is one of
   * those accounts. Item sales, escrow transactions and withdrawals carry no business
   * reference at all and are therefore excluded; `basis` says so in the response.
   *
   * gross is the sum of the booking price snapshots (`Booking.amount`, which
   * BookingsService writes when the booking is created/rescheduled), commission is the
   * business's own `commissionRate` applied per completed booking and rounded once per
   * booking, and net = gross - commission.
   */
  async getEarnings(userId: string) {
    const business = await this.getOwnedBusiness(userId);

    const partyIds = this.attributedPartyIds(business);
    const commissionRate = Number(business.commissionRate) || 0;

    const bookings = await this.bookingModel
      .find({ providerId: { $in: partyIds } })
      .populate('serviceId', 'title priceType location')
      .populate('customerId', 'firstName lastName')
      .populate('providerId', 'firstName lastName')
      .sort({ date: -1, startTime: -1 })
      .lean()
      .exec();

    // Cancelled and declined bookings never became work, so they are excluded from the job
    // counts; everything else (pending, confirmed, completed, no_show) is a job the business
    // was engaged for.
    const totalJobs = (bookings as any[]).filter(
      (booking) =>
        booking.status !== BookingStatus.CANCELLED &&
        booking.status !== BookingStatus.DECLINED,
    ).length;
    const payouts: any[] = [];
    let completedJobs = 0;
    let gross = 0;
    let commission = 0;

    for (const booking of bookings as any[]) {
      if (booking.status !== BookingStatus.COMPLETED) continue;

      const amount = Math.max(0, Number(booking.amount) || 0);
      const fee = Math.round((amount * commissionRate) / 100);
      completedJobs += 1;
      gross += amount;
      commission += fee;

      const customer = booking.customerId || {};
      const provider = booking.providerId || {};
      payouts.push({
        bookingId: booking._id?.toString(),
        serviceId: booking.serviceId?._id?.toString() || null,
        serviceTitle: booking.serviceId?.title || 'Service removed',
        providerId: provider._id?.toString() || null,
        providerName: this.fullName(provider) || 'Unknown provider',
        customerId: customer._id?.toString() || null,
        customerName: this.fullName(customer),
        date: booking.date,
        startTime: booking.startTime,
        endTime: booking.endTime,
        gross: amount,
        commission: fee,
        net: amount - fee,
        paymentStatus: booking.paymentStatus || 'unpaid',
        payoutReleased: booking.payoutReleased === true,
      });
    }

    // payouts are newest-first from the sort above; the cap keeps an old business's response
    // bounded while the totals above still cover every completed booking.
    const recentPayouts = payouts.slice(0, PAYOUT_HISTORY_LIMIT);

    return {
      totalJobs,
      completedJobs,
      gross,
      commission,
      net: gross - commission,
      payouts: recentPayouts,
      commissionRate,
      currency: 'NGN',
      basis: this.describeBasis(totalJobs, completedJobs, business, commissionRate),
    };
  }

  // ---------------------------------------------------------------------------------------
  // Admin surface
  // ---------------------------------------------------------------------------------------

  /** Every business with the counts the admin dashboard renders. */
  async listForAdmin(query: any) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query?.limit) || 20));

    const filter: any = {};
    if (query?.isActive !== undefined) {
      filter.isActive = this.parseBoolean(query.isActive, 'isActive');
    }
    if (query?.isVerified !== undefined) {
      filter.isVerified = this.parseBoolean(query.isVerified, 'isVerified');
    }
    if (query?.category) {
      filter.category = String(query.category).trim().toLowerCase();
    }
    if (query?.search) {
      const search = new RegExp(this.escapeRegex(String(query.search).trim()), 'i');
      filter.$or = [{ name: search }, { slug: search }, { email: search }, { category: search }];
    }

    const [businesses, total] = await Promise.all([
      this.businessModel
        .find(filter)
        .populate('ownerId', OWNER_POPULATE)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.businessModel.countDocuments(filter),
    ]);

    const work = await this.bookingTotalsByBusiness(businesses as any[]);

    const data = (businesses as any[]).map((business) => {
      const totals = work.get(business._id.toString()) || {
        bookings: 0,
        totalJobs: 0,
        completedBookings: 0,
        gross: 0,
      };
      const rate = Number(business.commissionRate) || 0;
      const staff = business.staff || [];
      const openings = business.openings || [];

      return {
        ...business,
        // Replaced with the live count; the stored counter may lag behind new bookings.
        totalJobs: totals.totalJobs,
        counts: {
          staff: staff.length,
          activeStaff: staff.filter((member: any) => member.isActive !== false).length,
          openings: openings.length,
          openOpenings: openings.filter((opening: any) => opening.isOpen !== false).length,
          bookings: totals.bookings,
          completedBookings: totals.completedBookings,
          gross: totals.gross,
          commission: Math.round((totals.gross * rate) / 100),
        },
      };
    });

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  }

  /** Admin-only money/trust update: commission rate, verification and pause. */
  async adminUpdate(id: string, dto: AdminUpdateBusinessDto) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Business not found');

    const update: any = {};
    if (dto?.commissionRate !== undefined) {
      const rate = Number(dto.commissionRate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 50) {
        throw new BadRequestException('commissionRate must be a number between 0 and 50');
      }
      // Percent of money: two decimal places is as precise as a rate should ever be.
      update.commissionRate = Math.round(rate * 100) / 100;
    }
    if (dto?.isVerified !== undefined) {
      update.isVerified = this.parseBoolean(dto.isVerified, 'isVerified');
    }
    if (dto?.isActive !== undefined) {
      update.isActive = this.parseBoolean(dto.isActive, 'isActive');
    }
    if (Object.keys(update).length === 0) {
      throw new BadRequestException(
        'No updatable fields provided. Allowed: commissionRate, isVerified, isActive',
      );
    }

    const business = await this.businessModel
      .findByIdAndUpdate(id, { $set: update }, { new: true })
      .populate('ownerId', OWNER_POPULATE)
      .exec();
    if (!business) throw new NotFoundException('Business not found');
    return business;
  }

  // ---------------------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------------------

  /**
   * Ownership scoping for every /businesses/me route. The query itself filters by ownerId,
   * so a caller can only ever get their own business; no business means a 404 that tells
   * them how to apply.
   */
  private async getOwnedBusiness(userId: string): Promise<Business> {
    const business = await this.businessModel.findOne({ ownerId: userId }).exec();
    if (!business) {
      throw new NotFoundException(
        'You do not have a business account yet. Apply with POST /businesses/apply.',
      );
    }
    return business;
  }

  /**
   * Ids are only ever looked up inside the caller's own business. An id that exists on
   * another business is a 403 (it is real, just not theirs); anything else is a 404.
   */
  private async findStaff(business: Business, staffId: string): Promise<BusinessStaff> {
    if (!Types.ObjectId.isValid(staffId)) throw new NotFoundException('Staff member not found');

    const member = (business.staff as any[]).find(
      (entry) => entry._id?.toString() === staffId,
    );
    if (member) return member;

    const foreign = await this.businessModel.exists({ 'staff._id': staffId });
    if (foreign) {
      throw new ForbiddenException('That staff member belongs to another business');
    }
    throw new NotFoundException('Staff member not found');
  }

  private async findOpening(business: Business, openingId: string): Promise<JobOpening> {
    if (!Types.ObjectId.isValid(openingId)) throw new NotFoundException('Opening not found');

    const opening = (business.openings as any[]).find(
      (entry) => entry._id?.toString() === openingId,
    );
    if (opening) return opening;

    const foreign = await this.businessModel.exists({ 'openings._id': openingId });
    if (foreign) {
      throw new ForbiddenException('That opening belongs to another business');
    }
    throw new NotFoundException('Opening not found');
  }

  /**
   * Owner account plus every staff account linked to a platform user, de-duplicated.
   *
   * Staff are included whether or not they are still active: work they completed while at the
   * business is still the business's revenue. Membership changes never rewrite history.
   */
  private attributedPartyIds(business: Business): Types.ObjectId[] {
    const ids = new Map<string, Types.ObjectId>();

    const ownerId = this.asObjectId(business.ownerId);
    if (ownerId) ids.set(ownerId.toString(), ownerId);

    for (const member of business.staff || []) {
      const userId = this.asObjectId(member?.userId);
      if (userId) ids.set(userId.toString(), userId);
    }

    return [...ids.values()];
  }

  /**
   * Normalises a reference that may be a raw ObjectId, a 24-hex string, or a fully
   * populated document.
   *
   * The admin list populates `ownerId` while the owner-facing paths do not, so
   * calling `.toString()` blindly turned a populated owner into the literal string
   * "[object Object]" and the following `new ObjectId(...)` threw a BSONError
   * (HTTP 500) on `GET /admin/businesses`. Anything unusable is dropped, not fatal.
   */
  private asObjectId(value: unknown): Types.ObjectId | null {
    if (!value) return null;

    if (value instanceof Types.ObjectId) return value;

    if (typeof value === 'object') {
      const inner = (value as { _id?: unknown })._id;
      return inner ? this.asObjectId(inner) : null;
    }

    if (typeof value === 'string' && Types.ObjectId.isValid(value)) {
      return new Types.ObjectId(value);
    }

    return null;
  }

  /**
   * One aggregation per admin list page instead of one query per business: group the page's
   * attributed providers, then fold each provider's totals into every business that claims
   * them (a staff member may work for more than one business).
   */
  private async bookingTotalsByBusiness(businesses: any[]) {
    const businessIdsByParty = new Map<string, string[]>();
    for (const business of businesses) {
      for (const partyId of this.attributedPartyIds(business)) {
        const key = partyId.toString();
        const list = businessIdsByParty.get(key) || [];
        list.push(business._id.toString());
        businessIdsByParty.set(key, list);
      }
    }

    const providerIds = [...businessIdsByParty.keys()].map((id) => new Types.ObjectId(id));
    if (!providerIds.length) return new Map<string, any>();

    const rows = await this.bookingModel
      .aggregate([
        { $match: { providerId: { $in: providerIds } } },
        {
          $group: {
            _id: '$providerId',
            bookings: { $sum: 1 },
            totalJobs: {
              $sum: {
                $cond: [{ $in: ['$status', [BookingStatus.CANCELLED, BookingStatus.DECLINED]] }, 0, 1],
              },
            },
            completedBookings: {
              $sum: { $cond: [{ $eq: ['$status', BookingStatus.COMPLETED] }, 1, 0] },
            },
            gross: {
              $sum: {
                $cond: [{ $eq: ['$status', BookingStatus.COMPLETED] }, '$amount', 0],
              },
            },
          },
        },
      ])
      .exec();

    const totals = new Map<string, any>();
    for (const row of rows as any[]) {
      for (const businessId of businessIdsByParty.get(row._id.toString()) || []) {
        const acc = totals.get(businessId) || {
          bookings: 0,
          totalJobs: 0,
          completedBookings: 0,
          gross: 0,
        };
        acc.bookings += row.bookings || 0;
        acc.totalJobs += row.totalJobs || 0;
        acc.completedBookings += row.completedBookings || 0;
        acc.gross += row.gross || 0;
        totals.set(businessId, acc);
      }
    }

    return totals;
  }

  /** Platform default commission, clamped to the same 0–50 range the admin API enforces. */
  private async defaultCommissionRate(): Promise<number> {
    const value = Number(await this.settingsService.getSetting(DEFAULT_COMMISSION_SETTING));
    if (Number.isFinite(value) && value >= 0 && value <= 50) return value;
    return 0;
  }

  /** Human-readable explanation of exactly what the ledger counted, returned to the client. */
  private describeBasis(
    totalJobs: number,
    completedJobs: number,
    business: Business,
    commissionRate: number,
  ): string {
    const linkedStaff = (business.staff || []).filter((member) => member?.userId).length;
    const parties =
      `the owner account and ${linkedStaff} staff account(s) linked to a platform user`;

    if (completedJobs === 0) {
      return (
        `No completed bookings are attributable to this business yet ` +
        `(${totalJobs} attributed booking(s) found for ${parties}), so every amount is zero. ` +
        `Attribution counts bookings whose provider is one of those accounts. Items, escrow ` +
        `transactions and withdrawals carry no business reference, so they are not counted.`
      );
    }

    return (
      `Computed live from ${completedJobs} completed booking(s) out of ${totalJobs} attributed ` +
      `booking(s) that were not cancelled or declined, for ${parties}. gross is the sum of the ` +
      `completed bookings' price snapshots, commission is ${commissionRate}% of each completed ` +
      `booking and net = gross - commission. Completed work is included even when its payout ` +
      `has not been released yet — each payout row reports its own paymentStatus and ` +
      `payoutReleased. Items, escrow transactions and withdrawals are excluded because no ` +
      `record links them to a business; payouts is the ${PAYOUT_HISTORY_LIMIT} most recent ` +
      `completed bookings.`
    );
  }

  /**
   * Lowercases and dash-normalises a slug, then validates it. Only whitespace/underscores are
   * rewritten — anything else invalid is rejected with an explanation instead of silently
   * mangled into a different address.
   */
  private normaliseSlug(raw: unknown): string {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new BadRequestException('slug is required');
    }

    const slug = raw.trim().toLowerCase().replace(/[\s_]+/g, '-');
    if (slug.length < SLUG_MIN_LENGTH || slug.length > SLUG_MAX_LENGTH) {
      throw new BadRequestException(
        `slug must be between ${SLUG_MIN_LENGTH} and ${SLUG_MAX_LENGTH} characters`,
      );
    }
    if (!SLUG_PATTERN.test(slug)) {
      throw new BadRequestException(
        'slug must be URL-safe: lowercase letters, numbers and single hyphens (e.g. "fumigpro")',
      );
    }
    if (RESERVED_SLUGS.has(slug)) {
      throw new BadRequestException(`"${slug}" is reserved for the platform. Choose another slug.`);
    }
    return slug;
  }

  private requireText(value: unknown, field: string, maxLength: number): string {
    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} is required`);
    }
    const clean = value.trim();
    if (!clean) throw new BadRequestException(`${field} cannot be empty`);
    if (clean.length > maxLength) {
      throw new BadRequestException(`${field} cannot be longer than ${maxLength} characters`);
    }
    return clean;
  }

  private cleanText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private parseOptionalAmount(value: unknown, field: string): number | undefined {
    if (value === undefined || value === null || (value as any) === '') return undefined;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw new BadRequestException(`${field} must be a number of at least 0`);
    }
    return numeric;
  }

  private parseBoolean(value: unknown, field: string): boolean {
    if (value === true || value === 'true' || value === '1' || value === 1) return true;
    if (value === false || value === 'false' || value === '0' || value === 0) return false;
    throw new BadRequestException(`${field} must be true or false`);
  }

  private parseJobType(value: unknown): JobType {
    if (!Object.values(JobType).includes(value as JobType)) {
      throw new BadRequestException(
        `type must be one of: ${Object.values(JobType).join(', ')}`,
      );
    }
    return value as JobType;
  }

  private fullName(user: any): string {
    if (!user) return '';
    return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private isDuplicateKey(error: any): boolean {
    return error?.code === 11000 || error?.cause?.code === 11000;
  }
}
