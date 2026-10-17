import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

// Keeps the recently-viewed list from growing without bound.
export const RECENTLY_VIEWED_LIMIT = 50;

/**
 * Payout bank account. `accountName` is only ever the value Paystack resolved from the
 * account number; an unverified account is never stored. `_id: false` keeps it as a plain
 * nested object rather than a separate collection.
 */
@Schema({ _id: false })
export class BankDetails {
  @Prop({ required: true })
  bankCode: string;

  @Prop({ required: true })
  bankName: string;

  @Prop({ required: true })
  accountNumber: string;

  @Prop({ required: true })
  accountName: string;
}

export const BankDetailsSchema = SchemaFactory.createForClass(BankDetails);

/**
 * Services-marketplace profile. A provider is a normal user with `isServiceProvider` set,
 * not a separate account and not a role. The counters are maintained by the booking
 * lifecycle; the profile endpoints never write them.
 */
@Schema({ _id: false })
export class ProviderProfile {
  @Prop()
  headline: string;

  @Prop()
  bio: string;

  @Prop([String])
  skills: string[];

  @Prop()
  serviceArea: string;

  @Prop({ default: true })
  isAcceptingBookings: boolean;

  @Prop({ default: 0 })
  rating: number;

  @Prop({ default: 0 })
  totalReviews: number;

  @Prop({ default: 0 })
  totalBookings: number;
}

export const ProviderProfileSchema = SchemaFactory.createForClass(ProviderProfile);

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ required: true })
  firstName: string;

  @Prop({ required: true })
  lastName: string;

  @Prop({ required: true, unique: true, lowercase: true })
  email: string;

  @Prop({ select: false })
  password: string;

  @Prop({ default: false })
  isVerified: boolean;

  // Minimal platform role. `false` is the default so no existing account gains admin
  // rights; the seed marks the seeded admin account and ADMIN_EMAILS can bootstrap one.
  @Prop({ default: false })
  isAdmin: boolean;

  // Suspension flag. Enforced at login and in JwtStrategy, so a suspended account cannot
  // keep using an already-issued token. Missing/undefined means active (legacy rows).
  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  googleId: string;

  @Prop()
  whatsappNumber: string;

  @Prop()
  university: string;

  @Prop()
  avatar: string;

  @Prop()
  hostel: string;

  @Prop()
  level: string;

  @Prop({ default: 0 })
  rating: number;

  @Prop({ default: 0 })
  totalTrades: number;

  @Prop({ default: 0 })
  walletBalance: number;

  // Bank account Paystack withdrawals are paid into. Optional until the user adds one.
  @Prop({ type: BankDetailsSchema, required: false })
  bankDetails?: BankDetails;

  @Prop()
  fcmToken: string; // Firebase Cloud Messaging device token for push notifications

  // Password reset: only the SHA-256 hash of the emailed token is stored, never the token
  // itself, and it expires. Both fields are excluded from every normal user query.
  @Prop({ select: false })
  passwordResetTokenHash: string;

  @Prop({ select: false })
  passwordResetExpires: Date;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Item' }], default: [] })
  recentlyViewed: Types.ObjectId[]; // Most-recent-first, de-duplicated, capped at RECENTLY_VIEWED_LIMIT

  // Services marketplace: true once the user has applied as a provider.
  @Prop({ default: false })
  isServiceProvider: boolean;

  @Prop({ type: ProviderProfileSchema, required: false })
  providerProfile?: ProviderProfile;
}

export const UserSchema = SchemaFactory.createForClass(User);
