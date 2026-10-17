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
}

export const UserSchema = SchemaFactory.createForClass(User);
