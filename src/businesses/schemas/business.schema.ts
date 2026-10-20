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
