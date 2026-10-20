import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';

/** Recruitment openings are one of these three shapes; the API validates against the enum. */
export enum JobType {
  FULL_TIME = 'full_time',
  PART_TIME = 'part_time',
  CONTRACT = 'contract',
}

/**
 * A person who works for the business. `userId` is optional on purpose: a crew member does
 * not need a platform account. When it is set it is the link the earnings ledger attributes
 * that person's completed bookings through.
 */

/**
 * The block types the page builder offers.
 *
 * A closed enum on purpose: the public page renders each type with a component it
 * already owns, so an unknown type can never reach the browser and render nothing.
 */
export enum PageBlockType {
  HERO = 'hero',
  ABOUT = 'about',
  SERVICES = 'services',
  GALLERY = 'gallery',
  HOURS = 'hours',
  FAQ = 'faq',
  TESTIMONIALS = 'testimonials',
  CONTACT = 'contact',
  CTA = 'cta',
}

/**
 * One section of a business's public page.
 *
 * `props` is intentionally loose — each block type owns its own shape — but the service
 * validates the type and caps the payload, so this cannot become an arbitrary document
 * store that the renderer then has to trust.
 */
export interface PageBlock {
  id: string;
  type: PageBlockType;
  isVisible: boolean;
  props: Record<string, unknown>;
}

export interface BusinessPage {
  blocks: PageBlock[];
  /** Hex accent used for buttons on the public page. */
  accentColor?: string;
  updatedAt?: Date;
}


/**
 * What kind of student business this is.
 *
 * The type is not cosmetic: it decides which tools the owner gets (a tutorial centre
 * needs a resource library, a jewellery seller needs stock and cost prices) and which
 * default page template suits it.
 */
export enum BusinessType {
  SERVICE = 'service',
  PRODUCT = 'product',
  TUTORIAL = 'tutorial',
  HYBRID = 'hybrid',
}

/** A thing the business sells, with the cost price that makes profit computable. */
export interface BusinessProduct {
  _id?: Types.ObjectId;
  name: string;
  description?: string;
  sku?: string;
  costPrice: number;
  sellPrice: number;
  stock: number;
  lowStockThreshold: number;
  images?: string[];
  isActive: boolean;
}

/**
 * A learning resource a tutorial centre publishes to students it has granted access to.
 *
 * `url` is deliberately opaque: the marketplace never exposes the raw storage path to a
 * student who has not been granted access.
 */
export enum ResourceKind {
  FILE = 'file',
  VIDEO = 'video',
  LINK = 'link',
}

export interface BusinessResource {
  _id?: Types.ObjectId;
  title: string;
  description?: string;
  kind: ResourceKind;
  url: string;
  /** Emails allowed to open it. Empty means the resource is not published. */
  grantedEmails?: string[];
  isActive: boolean;
  createdAt?: Date;
}

export interface BusinessStaff {
  _id?: Types.ObjectId;
  userId?: Types.ObjectId;
  name: string;
  role: string;
  phone?: string;
  isActive: boolean;
}

export interface JobOpening {
  _id?: Types.ObjectId;
  title: string;
  description: string;
  type: JobType;
  pay?: number;
  isOpen: boolean;
}

/** Where a candidate is in the hiring pipeline. */
export enum ApplicationStatus {
  NEW = 'new',
  SHORTLISTED = 'shortlisted',
  HIRED = 'hired',
  REJECTED = 'rejected',
}

/**
 * A person who applied to one of the business's openings.
 *
 * Applications are stored on the business rather than on the opening so the owner has one
 * inbox to work through, and so an application survives the opening being edited or closed.
 */
export interface JobApplication {
  _id?: Types.ObjectId;
  openingId?: Types.ObjectId;
  openingTitle: string;
  name: string;
  email: string;
  phone?: string;
  message?: string;
  status: ApplicationStatus;
  note?: string;
  createdAt?: Date;
}

/** Payout lifecycle. Only `paid` means the money has actually left. */
export enum PayoutStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  PAID = 'paid',
  FAILED = 'failed',
}

export interface BusinessPayout {
  _id?: Types.ObjectId;
  amount: number;
  status: PayoutStatus;
  /** Human-readable reason when a payout fails, shown to the owner. */
  failureReason?: string;
  requestedAt?: Date;
  processedAt?: Date;
}

/** A physical branch. A business that scales opens more than one. */
export interface BusinessLocation {
  _id?: Types.ObjectId;
  name: string;
  address?: string;
  phone?: string;
  isActive: boolean;
}

/**
 * How much the business wants the platform to do on its behalf.
 *
 * These are switches the owner controls; the booking path reads them. Defaults are the
 * conservative ones — nothing is auto-accepted until the owner asks for it.
 */
export interface BusinessAutomation {
  /** Accept a new booking immediately instead of waiting for a human. */
  autoAccept: boolean;
  /** Assign the booking to an active crew member on creation. */
  autoAssign: boolean;
  /** How far ahead a job must be to be accepted automatically, in minutes. */
  leadTimeMinutes: number;
  /** Cap on jobs accepted on any one day. 0 = no cap. */
  maxDailyJobs: number;
  /** Gap left after a job before the next one can start. */
  bufferMinutes: number;
}

/**
 * A business vendor account — the "company" counterpart of an individual provider.
 *
 * It is a separate collection rather than another flag on User because a business has its
 * own staff, recruitment, payout ledger and subdomain, and one person may manage it without
 * turning their own account into a company. The public address of a business is `slug`.
 *
 * `commissionRate` and `isVerified` are admin-controlled money/trust fields: they are absent
 * from the owner whitelist in BusinessesService and are only writable through
 * PATCH /admin/businesses/:id.
 *
 * `rating`/`totalJobs` are denormalised counters for cards and lists. Money is never read
 * from `totalJobs`: GET /businesses/me/earnings recomputes the ledger from bookings.
 */
@Schema({ timestamps: true, collection: 'businesses' })
export class Business extends Document {
  // Indexed by the unique ownerId index below, not by @Prop, so the index is not declared twice.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  ownerId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  // The subdomain and the public lookup key. Lowercased and URL-safe; enforced unique so two
  // businesses can never answer on the same address.
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ required: true, trim: true, index: true })
  category: string;

  @Prop({ default: '' })
  description: string;

  @Prop()
  logo: string;

  @Prop()
  banner: string;

  @Prop()
  phone: string;

  @Prop({ lowercase: true, trim: true })
  email: string;

  @Prop()
  address: string;

  // Owner or admin can pause a business; a paused business disappears from the public page.
  @Prop({ default: true, index: true })
  isActive: boolean;

  // Admin only. Kept separate from isActive so "not yet reviewed" is not the same as "paused".
  @Prop({ default: false })
  isVerified: boolean;

  // Percent of each completed job Erranders keeps. Set only by an admin, 0–50.
  @Prop({ default: 0, min: 0, max: 50 })
  commissionRate: number;

  @Prop({
    type: [
      {
        userId: { type: MongooseSchema.Types.ObjectId, ref: 'User' },
        name: { type: String, required: true, trim: true },
        role: { type: String, required: true, trim: true },
        phone: { type: String, trim: true },
        isActive: { type: Boolean, default: true },
      },
    ],
    default: [],
  })
  staff: BusinessStaff[];

  @Prop({
    type: [
      {
        title: { type: String, required: true, trim: true },
        description: { type: String, default: '' },
        type: { type: String, enum: JobType, default: JobType.FULL_TIME },
        pay: { type: Number, min: 0 },
        isOpen: { type: Boolean, default: true },
      },
    ],
    default: [],
  })
  openings: JobOpening[];

  @Prop({
    type: [
      {
        openingId: { type: MongooseSchema.Types.ObjectId },
        openingTitle: { type: String, default: '' },
        name: { type: String, required: true, trim: true },
        email: { type: String, required: true, lowercase: true, trim: true },
        phone: { type: String, trim: true },
        message: { type: String, default: '' },
        status: {
          type: String,
          enum: ApplicationStatus,
          default: ApplicationStatus.NEW,
        },
        note: { type: String, default: '' },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  applications: JobApplication[];

  @Prop({
    type: [
      {
        amount: { type: Number, required: true, min: 0 },
        status: { type: String, enum: PayoutStatus, default: PayoutStatus.PENDING },
        failureReason: { type: String, default: '' },
        requestedAt: { type: Date, default: Date.now },
        processedAt: { type: Date },
      },
    ],
    default: [],
  })
  payouts: BusinessPayout[];

  @Prop({
    type: [
      {
        name: { type: String, required: true, trim: true },
        address: { type: String, default: '' },
        phone: { type: String, default: '' },
        isActive: { type: Boolean, default: true },
      },
    ],
    default: [],
  })
  locations: BusinessLocation[];

  /**
   * The owner-designed public page. Empty means "use the default layout", so a business
   * that never opens the builder still gets a sensible page.
   */
  @Prop({ type: String, enum: BusinessType, default: BusinessType.SERVICE, index: true })
  businessType: BusinessType;

  /** The page template last applied, so the owner can see what they started from. */
  @Prop({ default: '' })
  templateId: string;

  @Prop({
    type: [
      {
        name: { type: String, required: true, trim: true },
        description: { type: String, default: '' },
        sku: { type: String, default: '' },
        costPrice: { type: Number, default: 0, min: 0 },
        sellPrice: { type: Number, default: 0, min: 0 },
        stock: { type: Number, default: 0 },
        lowStockThreshold: { type: Number, default: 3, min: 0 },
        images: { type: [String], default: [] },
        isActive: { type: Boolean, default: true },
      },
    ],
    default: [],
  })
  products: BusinessProduct[];

  @Prop({
    type: [
      {
        title: { type: String, required: true, trim: true },
        description: { type: String, default: '' },
        kind: { type: String, enum: ResourceKind, default: ResourceKind.FILE },
        url: { type: String, required: true },
        grantedEmails: { type: [String], default: [] },
        isActive: { type: Boolean, default: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  resources: BusinessResource[];

  @Prop({
    type: {
      blocks: [
        {
          id: { type: String, required: true },
          type: { type: String, enum: PageBlockType, required: true },
          isVisible: { type: Boolean, default: true },
          props: { type: Object, default: {} },
        },
      ],
      accentColor: { type: String, default: '' },
      updatedAt: { type: Date },
    },
    default: () => ({ blocks: [], accentColor: '' }),
  })
  page: BusinessPage;

  @Prop({
    type: {
      autoAccept: { type: Boolean, default: false },
      autoAssign: { type: Boolean, default: false },
      leadTimeMinutes: { type: Number, default: 120, min: 0 },
      maxDailyJobs: { type: Number, default: 0, min: 0 },
      bufferMinutes: { type: Number, default: 0, min: 0 },
    },
    default: () => ({
      autoAccept: false,
      autoAssign: false,
      leadTimeMinutes: 120,
      maxDailyJobs: 0,
      bufferMinutes: 0,
    }),
  })
  automation: BusinessAutomation;

  @Prop({ default: 0 })
  rating: number;

  @Prop({ default: 0 })
  totalJobs: number;
}

export const BusinessSchema = SchemaFactory.createForClass(Business);

// One business per account: GET /businesses/me assumes a single business, and the apply
// endpoint refuses a second one. The unique index makes that true under concurrent applies.
BusinessSchema.index({ ownerId: 1 }, { unique: true });
// Public directory: active businesses by category, newest first.
BusinessSchema.index({ isActive: 1, category: 1, createdAt: -1 });
